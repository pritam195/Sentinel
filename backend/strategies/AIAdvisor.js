import { performance } from 'perf_hooks';
import CommerceAdvisor from './CommerceAdvisor.js';
import RuleBasedAdvisor from './RuleBasedAdvisor.js';
import { callLLM, callLLMStream } from '../services/llmGateway.js';
import { recordAICall } from '../services/metrics.js';

class AIAdvisor extends CommerceAdvisor {
  constructor(options = {}) {
    super();
    this.fallbackAdvisor = options.fallbackAdvisor || new RuleBasedAdvisor();
    this.callLLMFn = options.callLLM || callLLM;
    this.callLLMStreamFn = options.callLLMStream || callLLMStream;
    this.maxSingleChangePercent = options.maxSingleChangePercent ?? 20;
  }

  _classifyError(error) {
    const msg = error?.message || '';
    const code = error?.code || '';
    let reason = 'UPSTREAM_ERROR';
    let outcome = 'api_error';

    if (code === 'CIRCUIT_OPEN' || msg.includes('Circuit breaker is OPEN') || msg.includes('CIRCUIT_OPEN')) {
      reason = 'CIRCUIT_OPEN';
      outcome = 'circuit_open';
    } else if (code === 'RATE_LIMITED' || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      reason = 'RATE_LIMITED';
      outcome = 'rate_limited';
    } else if (code === 'TIMEOUT' || error?.name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout')) {
      reason = 'TIMEOUT';
      outcome = 'timeout';
    } else if (code === 'MALFORMED_JSON' || msg.includes('did not contain JSON') || error instanceof SyntaxError || msg.includes('Unexpected token')) {
      reason = 'MALFORMED_JSON';
      outcome = 'malformed_json';
    } else if (code === 'SCHEMA_INVALID' || msg.includes('Schema validation failed')) {
      reason = 'SCHEMA_INVALID';
      outcome = 'schema_invalid';
    } else if (code === 'IMPLAUSIBLE_OUTPUT' || msg.includes('Plausibility check failed')) {
      reason = 'IMPLAUSIBLE_OUTPUT';
      outcome = 'implausible_output';
    }

    return { reason, outcome };
  }

  // Stage 1: Schema validation
  _validateSchema(value, type = 'pricing') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      const err = new Error('Schema validation failed: response must be a JSON object');
      err.code = 'SCHEMA_INVALID';
      throw err;
    }

    if (type === 'pricing') {
      const requiredFields = ['recommendedPrice', 'direction', 'confidence', 'reasoning'];
      for (const field of requiredFields) {
        if (value[field] === undefined || value[field] === null) {
          const err = new Error(`Schema validation failed: missing required field '${field}'`);
          err.code = 'SCHEMA_INVALID';
          throw err;
        }
      }

      if (typeof value.recommendedPrice !== 'number' || !Number.isFinite(value.recommendedPrice)) {
        const err = new Error('Schema validation failed: recommendedPrice must be a finite number');
        err.code = 'SCHEMA_INVALID';
        throw err;
      }

      const allowedDirections = ['INCREASE', 'DECREASE', 'HOLD'];
      if (!allowedDirections.includes(value.direction)) {
        const err = new Error(`Schema validation failed: direction must be one of ${allowedDirections.join(', ')}`);
        err.code = 'SCHEMA_INVALID';
        throw err;
      }

      const conf = Number(value.confidence);
      if (typeof value.confidence !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) {
        const err = new Error('Schema validation failed: confidence must be a finite number in [0, 1]');
        err.code = 'SCHEMA_INVALID';
        throw err;
      }

      if (typeof value.reasoning !== 'string' || !value.reasoning.trim()) {
        const err = new Error('Schema validation failed: reasoning must be a non-empty string');
        err.code = 'SCHEMA_INVALID';
        throw err;
      }
    } else if (type === 'reorder') {
      const requiredFields = ['recommendedQuantity', 'confidence', 'reasoning'];
      for (const field of requiredFields) {
        if (value[field] === undefined || value[field] === null) {
          const err = new Error(`Schema validation failed: missing required field '${field}'`);
          err.code = 'SCHEMA_INVALID';
          throw err;
        }
      }

      if (typeof value.recommendedQuantity !== 'number' || !Number.isInteger(value.recommendedQuantity)) {
        const err = new Error('Schema validation failed: recommendedQuantity must be an integer');
        err.code = 'SCHEMA_INVALID';
        throw err;
      }

      if (value.suggestedLeadTimeDays !== undefined && value.suggestedLeadTimeDays !== null) {
        if (typeof value.suggestedLeadTimeDays !== 'number' || !Number.isInteger(value.suggestedLeadTimeDays)) {
          const err = new Error('Schema validation failed: suggestedLeadTimeDays must be an integer');
          err.code = 'SCHEMA_INVALID';
          throw err;
        }
      }

      const conf = Number(value.confidence);
      if (typeof value.confidence !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) {
        const err = new Error('Schema validation failed: confidence must be a finite number in [0, 1]');
        err.code = 'SCHEMA_INVALID';
        throw err;
      }

      if (typeof value.reasoning !== 'string' || !value.reasoning.trim()) {
        const err = new Error('Schema validation failed: reasoning must be a non-empty string');
        err.code = 'SCHEMA_INVALID';
        throw err;
      }
    }
  }

  // Stage 2: Plausibility check
  _validatePlausibility(value, product, type = 'pricing') {
    if (type === 'pricing') {
      const price = Number(value.recommendedPrice);
      if (!Number.isFinite(price) || price <= 0) {
        const err = new Error(`Plausibility check failed: price must be positive and finite (got ${price})`);
        err.code = 'IMPLAUSIBLE_OUTPUT';
        throw err;
      }

      const minPlausible = product.currentPrice * 0.5;
      const maxPlausible = product.currentPrice * 3.0;

      if (price < minPlausible || price > maxPlausible) {
        const err = new Error(
          `Plausibility check failed: recommended price $${price} is outside 0.5x-3.0x range [$${minPlausible.toFixed(2)}, $${maxPlausible.toFixed(2)}] of current price $${product.currentPrice}`
        );
        err.code = 'IMPLAUSIBLE_OUTPUT';
        throw err;
      }
    } else if (type === 'reorder') {
      const qty = Number(value.recommendedQuantity);
      const maxAllowedQty = Math.max(product.reorderThreshold * 20, 10000);
      if (qty < 0 || qty > maxAllowedQty) {
        const err = new Error(`Plausibility check failed: absurd reorder quantity ${qty} (valid range: [0, ${maxAllowedQty}])`);
        err.code = 'IMPLAUSIBLE_OUTPUT';
        throw err;
      }

      const leadTime = Number(value.suggestedLeadTimeDays ?? 7);
      if (leadTime < 1 || leadTime > 365) {
        const err = new Error(`Plausibility check failed: suggestedLeadTimeDays ${leadTime} outside [1, 365]`);
        err.code = 'IMPLAUSIBLE_OUTPUT';
        throw err;
      }
    }
  }

  // Stage 3: Policy clamps
  _applyPricingPolicyClamps(value, product, options = {}) {
    const rawPrice = Math.round(Number(value.recommendedPrice) * 100) / 100;
    let clampedPrice = rawPrice;
    let wasClamped = false;
    const clampReasons = [];

    // maxSingleChangePercent
    const maxPercent = options.maxSingleChangePercent ?? this.maxSingleChangePercent ?? 20;
    const maxDelta = product.currentPrice * (maxPercent / 100);
    const maxAllowed = Math.round((product.currentPrice + maxDelta) * 100) / 100;
    const minAllowed = Math.round((product.currentPrice - maxDelta) * 100) / 100;

    if (clampedPrice > maxAllowed) {
      clampedPrice = maxAllowed;
      wasClamped = true;
      clampReasons.push(`clamped to max single change limit of +${maxPercent}%`);
    } else if (clampedPrice < minAllowed) {
      clampedPrice = minAllowed;
      wasClamped = true;
      clampReasons.push(`clamped to max single change limit of -${maxPercent}%`);
    }

    // Margin floor from costPrice takes precedence over downwards volatility limits
    if (product.costPrice != null && product.costPrice > 0) {
      const minMargin = product.minMarginPercent != null
        ? (product.minMarginPercent > 1 ? product.minMarginPercent / 100 : product.minMarginPercent)
        : 0;
      const marginFloor = Math.round(product.costPrice * (1 + minMargin) * 100) / 100;
      if (clampedPrice < marginFloor) {
        clampedPrice = marginFloor;
        wasClamped = true;
        clampReasons.push(`clamped to margin floor of $${marginFloor.toFixed(2)}`);
      }
    }

    const cleanReasoning = value.reasoning.trim().replace(/^\[AI Analysis\]\s*/i, '');
    const reasoning = wasClamped
      ? `[AI Analysis] ${cleanReasoning} [${clampReasons.join('; ')}]`
      : `[AI Analysis] ${cleanReasoning}`;

    return {
      recommendedPrice: clampedPrice,
      rawRecommendedPrice: rawPrice,
      rawPrice,
      direction: value.direction,
      confidence: Number(value.confidence),
      reasoning,
      wasClamped,
      clampReasons,
      outcome: wasClamped ? 'clamped_by_policy' : 'success'
    };
  }

  _applyReorderPolicyClamps(value, product, options = {}) {
    const rawQty = Number(value.recommendedQuantity);
    const leadTime = Number(value.suggestedLeadTimeDays ?? 7);
    const cleanReasoning = value.reasoning.trim().replace(/^\[AI Analysis\]\s*/i, '');
    return {
      recommendedQuantity: rawQty,
      rawRecommendedQuantity: rawQty,
      rawQuantity: rawQty,
      suggestedLeadTimeDays: leadTime,
      confidence: Number(value.confidence),
      reasoning: `[AI Analysis] ${cleanReasoning}`,
      wasClamped: false,
      clampReasons: [],
      outcome: 'success'
    };
  }

  async suggestPricing(product, categoryAverageVelocity, triggerReason, options = {}) {
    const startTime = performance.now();
    try {
      const prompt = this._buildPricingPrompt(product, categoryAverageVelocity, triggerReason);
      const response = await this.callLLMFn(prompt);
      const parsed = this._parseJSONResponse(response);
      
      // Stage 1: Schema validation
      this._validateSchema(parsed, 'pricing');

      // Stage 2: Plausibility check
      this._validatePlausibility(parsed, product, 'pricing');

      // Stage 3: Policy clamps
      const result = this._applyPricingPolicyClamps(parsed, product, options);
      const latencyMs = performance.now() - startTime;

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'pricing',
          outcome: result.outcome,
          latencyMs,
          fellBack: false,
          fallbackReason: null,
          inputDetails: {
            currentPrice: product.currentPrice,
            stockLevel: product.stockLevel,
            demandVelocity: product.demandVelocity
          },
          outputDetails: result
        });
      } catch (logErr) {
        console.error('[AIAdvisor] Log error:', logErr.message);
      }

      return {
        ...result,
        isFallback: false,
        fallbackReason: null
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const { reason, outcome } = this._classifyError(error);
      const fallback = await this._fallbackPricing(product, categoryAverageVelocity, triggerReason, reason, error);

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'pricing',
          outcome,
          latencyMs,
          fellBack: true,
          fallbackReason: reason,
          inputDetails: {
            currentPrice: product.currentPrice,
            stockLevel: product.stockLevel,
            demandVelocity: product.demandVelocity
          },
          outputDetails: fallback
        });
      } catch (logErr) {
        console.error('[AIAdvisor] Log error:', logErr.message);
      }

      return fallback;
    }
  }

  async suggestPricingStream(product, categoryAverageVelocity, triggerReason, onChunk, options = {}) {
    const startTime = performance.now();
    try {
      const prompt = this._buildPricingPrompt(product, categoryAverageVelocity, triggerReason);
      const response = await this.callLLMStreamFn(prompt, onChunk);
      const parsed = this._parseJSONResponse(response);
      
      // Stage 1: Schema validation
      this._validateSchema(parsed, 'pricing');

      // Stage 2: Plausibility check
      this._validatePlausibility(parsed, product, 'pricing');

      // Stage 3: Policy clamps
      const result = this._applyPricingPolicyClamps(parsed, product, options);
      const latencyMs = performance.now() - startTime;

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'pricing',
          outcome: result.outcome,
          latencyMs,
          fellBack: false,
          fallbackReason: null,
          outputDetails: result
        });
      } catch (logErr) {}

      return {
        ...result,
        isFallback: false,
        fallbackReason: null
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const { reason, outcome } = this._classifyError(error);
      if (onChunk) onChunk(`\n[AI unavailable (${reason}); using safe rule-based fallback]\n`);
      const fallback = await this._fallbackPricing(product, categoryAverageVelocity, triggerReason, reason, error);

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'pricing',
          outcome,
          latencyMs,
          fellBack: true,
          fallbackReason: reason,
          outputDetails: fallback
        });
      } catch (logErr) {}

      return fallback;
    }
  }

  async suggestReorder(product, triggerReason, options = {}) {
    const startTime = performance.now();
    try {
      const prompt = this._buildReorderPrompt(product, triggerReason);
      const response = await this.callLLMFn(prompt);
      const parsed = this._parseJSONResponse(response);
      
      // Stage 1: Schema validation
      this._validateSchema(parsed, 'reorder');

      // Stage 2: Plausibility check
      this._validatePlausibility(parsed, product, 'reorder');

      // Stage 3: Policy clamps
      const result = this._applyReorderPolicyClamps(parsed, product, options);
      const latencyMs = performance.now() - startTime;

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'reorder',
          outcome: result.outcome,
          latencyMs,
          fellBack: false,
          fallbackReason: null,
          inputDetails: {
            stockLevel: product.stockLevel,
            reorderThreshold: product.reorderThreshold,
            demandVelocity: product.demandVelocity
          },
          outputDetails: result
        });
      } catch (logErr) {}

      return {
        ...result,
        isFallback: false,
        fallbackReason: null
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const { reason, outcome } = this._classifyError(error);
      const fallbackBase = await this.fallbackAdvisor.suggestReorder(product, triggerReason);
      const fallback = {
        ...fallbackBase,
        isFallback: true,
        fallbackReason: reason,
        reasoning: `[Fallback: ${reason} — AI unavailable: ${error.message}] ${fallbackBase.reasoning}`
      };

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'reorder',
          outcome,
          latencyMs,
          fellBack: true,
          fallbackReason: reason,
          inputDetails: {
            stockLevel: product.stockLevel,
            reorderThreshold: product.reorderThreshold,
            demandVelocity: product.demandVelocity
          },
          outputDetails: fallback
        });
      } catch (logErr) {}

      return fallback;
    }
  }

  async _fallbackPricing(product, categoryAverageVelocity, triggerReason, reason, error) {
    const fallback = await this.fallbackAdvisor.suggestPricing(product, categoryAverageVelocity, triggerReason);
    return {
      ...fallback,
      isFallback: true,
      fallbackReason: reason,
      reasoning: `[Fallback: ${reason} — AI unavailable: ${error.message}] ${fallback.reasoning}`
    };
  }

  _buildPricingPrompt(product, categoryAverageVelocity, triggerReason) {
    const context = `Product: ${product.name} (SKU: ${product.sku}, category: ${product.category})
Current price: ${product.currentPrice}
Stock: ${product.stockLevel}; reorder threshold: ${product.reorderThreshold}
Demand velocity (orders in 24h): ${product.demandVelocity}; category average: ${categoryAverageVelocity || 0}`;
    const instruction = triggerReason === 'INVENTORY_LOW'
      ? 'Inventory is below its reorder threshold. Explain the trade-off between protecting scarce stock with a price increase and clearing remaining stock; choose the recommendation appropriate to the supplied context.'
      : triggerReason === 'DEMAND_SPIKE'
        ? 'Demand is materially above category peers. Explain a modest, customer-conscious price response that captures demand without an excessive increase.'
        : 'This is a merchandiser-requested review. Assess inventory and demand before deciding whether to increase, decrease, or hold price.';
    return `You are Sentinel, a careful commerce advisor.\n${context}\n\n${instruction}\n\nReturn only JSON: {"recommendedPrice":number,"direction":"INCREASE"|"DECREASE"|"HOLD","confidence":number,"reasoning":"plain-English explanation"}. Price must be positive and within 0.5x to 3x the current price.`;
  }

  _buildReorderPrompt(product, triggerReason) {
    const instruction = triggerReason === 'DEMAND_SPIKE'
      ? 'Size replenishment for sustained elevated demand, not only the normal threshold.'
      : triggerReason === 'INVENTORY_LOW'
        ? 'Restore healthy coverage while the product is below its reorder threshold.'
        : 'Recommend a prudent normal replenishment amount.';
    return `You are Sentinel, a careful inventory advisor.\nProduct: ${product.name} (SKU: ${product.sku}, category: ${product.category})\nStock: ${product.stockLevel}; reorder threshold: ${product.reorderThreshold}; demand velocity: ${product.demandVelocity} orders in 24h.\n\n${instruction}\n\nReturn only JSON: {"recommendedQuantity":positive integer,"suggestedLeadTimeDays":positive integer,"confidence":number,"reasoning":"plain-English explanation"}.`;
  }

  _parseJSONResponse(text) {
    const match = String(text).trim().match(/\{[\s\S]*\}/);
    if (!match) {
      const err = new Error('AI response did not contain JSON');
      err.code = 'MALFORMED_JSON';
      throw err;
    }
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      const err = new Error(`Malformed JSON: ${e.message}`);
      err.code = 'MALFORMED_JSON';
      throw err;
    }
  }
}

export default AIAdvisor;
