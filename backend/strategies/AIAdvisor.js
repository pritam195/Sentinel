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
  }

  _classifyError(error) {
    const msg = error?.message || '';
    if (error?.name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout')) {
      return 'timeout';
    }
    if (msg.includes('did not contain JSON') || error instanceof SyntaxError || msg.includes('Unexpected token')) {
      return 'malformed_json';
    }
    if (msg.includes('failed safety validation') || msg.includes('out of bounds') || msg.includes('clamp')) {
      return 'out_of_bounds_clamped';
    }
    return 'api_error';
  }

  async suggestPricing(product, categoryAverageVelocity, triggerReason) {
    const startTime = performance.now();
    try {
      const prompt = this._buildPricingPrompt(product, categoryAverageVelocity, triggerReason);
      const response = await this.callLLMFn(prompt);
      const parsed = this._parseJSONResponse(response);
      const result = this._validatePricing(parsed, product);
      const latencyMs = performance.now() - startTime;

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'pricing',
          outcome: 'success',
          latencyMs,
          fellBack: false,
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

      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const outcome = this._classifyError(error);
      const fallback = await this._fallbackPricing(product, categoryAverageVelocity, triggerReason, error);

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
          fallbackReason: error.message,
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

  async suggestPricingStream(product, categoryAverageVelocity, triggerReason, onChunk) {
    const startTime = performance.now();
    try {
      const prompt = this._buildPricingPrompt(product, categoryAverageVelocity, triggerReason);
      const response = await this.callLLMStreamFn(prompt, onChunk);
      const parsed = this._parseJSONResponse(response);
      const result = this._validatePricing(parsed, product);
      const latencyMs = performance.now() - startTime;

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'pricing',
          outcome: 'success',
          latencyMs,
          fellBack: false,
          outputDetails: result
        });
      } catch (logErr) {}

      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const outcome = this._classifyError(error);
      if (onChunk) onChunk(`\n[AI unavailable; using safe rule-based fallback: ${error.message}]\n`);
      const fallback = await this._fallbackPricing(product, categoryAverageVelocity, triggerReason, error);

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
          fallbackReason: error.message,
          outputDetails: fallback
        });
      } catch (logErr) {}

      return fallback;
    }
  }

  async suggestReorder(product, triggerReason) {
    const startTime = performance.now();
    try {
      const prompt = this._buildReorderPrompt(product, triggerReason);
      const response = await this.callLLMFn(prompt);
      const parsed = this._parseJSONResponse(response);
      const result = this._validateReorder(parsed, product);
      const latencyMs = performance.now() - startTime;

      try {
        await recordAICall({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          callType: 'reorder',
          outcome: 'success',
          latencyMs,
          fellBack: false,
          inputDetails: {
            stockLevel: product.stockLevel,
            reorderThreshold: product.reorderThreshold,
            demandVelocity: product.demandVelocity
          },
          outputDetails: result
        });
      } catch (logErr) {}

      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const outcome = this._classifyError(error);
      const fallbackBase = await this.fallbackAdvisor.suggestReorder(product, triggerReason);
      const fallback = {
        ...fallbackBase,
        reasoning: `[Fallback — AI unavailable: ${error.message}] ${fallbackBase.reasoning}`
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
          fallbackReason: error.message,
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

  async _fallbackPricing(product, categoryAverageVelocity, triggerReason, error) {
    const fallback = await this.fallbackAdvisor.suggestPricing(product, categoryAverageVelocity, triggerReason);
    return { ...fallback, reasoning: `[Fallback — AI unavailable: ${error.message}] ${fallback.reasoning}` };
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
    if (!match) throw new Error('AI response did not contain JSON');
    return JSON.parse(match[0]);
  }

  _validatePricing(value, product) {
    const recommendedPrice = Number(value.recommendedPrice);
    const allowedDirections = ['INCREASE', 'DECREASE', 'HOLD'];
    if (!Number.isFinite(recommendedPrice) || recommendedPrice <= 0 ||
      recommendedPrice < product.currentPrice * 0.5 || recommendedPrice > product.currentPrice * 3 ||
      !allowedDirections.includes(value.direction) ||
      !Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 1 ||
      typeof value.reasoning !== 'string' || !value.reasoning.trim()) {
      throw new Error('AI pricing response failed safety validation');
    }
    const cleanReasoning = value.reasoning.trim().replace(/^\[AI Analysis\]\s*/i, '');
    return { 
      recommendedPrice: Math.round(recommendedPrice * 100) / 100, 
      direction: value.direction, 
      confidence: Number(value.confidence), 
      reasoning: `[AI Analysis] ${cleanReasoning}` 
    };
  }

  _validateReorder(value, product) {
    const recommendedQuantity = Number(value.recommendedQuantity);
    const suggestedLeadTimeDays = Number(value.suggestedLeadTimeDays ?? 7);
    if (!Number.isInteger(recommendedQuantity) || recommendedQuantity < 1 || recommendedQuantity > Math.max(product.reorderThreshold * 20, 10000) ||
      !Number.isInteger(suggestedLeadTimeDays) || suggestedLeadTimeDays < 1 || suggestedLeadTimeDays > 365 ||
      !Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 1 ||
      typeof value.reasoning !== 'string' || !value.reasoning.trim()) {
      throw new Error('AI reorder response failed safety validation');
    }
    const cleanReasoning = value.reasoning.trim().replace(/^\[AI Analysis\]\s*/i, '');
    return { 
      recommendedQuantity, 
      suggestedLeadTimeDays, 
      confidence: Number(value.confidence), 
      reasoning: `[AI Analysis] ${cleanReasoning}` 
    };
  }
}

export default AIAdvisor;
