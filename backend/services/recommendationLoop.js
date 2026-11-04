import inventoryEvents from '../events/inventoryEvents.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import { getActiveStrategy } from '../strategies/registry.js';
import Config from '../models/Config.js';
import { recordTrigger, recordAICall } from './metrics.js';

// In-flight mutex set: purely an in-process optimization to reduce duplicate work
export const inFlightLocks = new Set();

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.codeName === 'DuplicateKey' || (err.name === 'MongoServerError' && err.code === 11000));
}

/**
 * Sweeps and transitions expired PENDING suggestions to EXPIRED
 */
export async function expirePendingSuggestions() {
  const now = new Date();
  const [pricingExpired, reorderExpired] = await Promise.all([
    PricingSuggestion.updateMany(
      { status: 'PENDING', expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED' } }
    ),
    ReorderSuggestion.updateMany(
      { status: 'PENDING', expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED' } }
    )
  ]);
  return {
    pricingExpired: pricingExpired.modifiedCount,
    reorderExpired: reorderExpired.modifiedCount
  };
}

export async function processInventoryChange(product) {
  // 1. Calculate category average velocity
  const categoryProducts = await Product.find({ category: product.category });
  const totalVelocity = categoryProducts.reduce((sum, p) => sum + p.demandVelocity, 0);
  const categoryAverageVelocity = categoryProducts.length > 0 ? totalVelocity / categoryProducts.length : 0;

  const triggers = [];

  // Trigger A: Inventory Low
  if (product.stockLevel < product.reorderThreshold) {
    triggers.push('INVENTORY_LOW');
  }

  // Trigger B: Demand Spike (velocity > multiplier * category avg)
  const config = await Config.findOne();
  const demandSpikeMultiplier = config?.demandSpikeMultiplier ?? 3;
  const maxSingleChangePercent = config?.maxSingleChangePercent ?? 20;
  const maxChangesPer24h = config?.maxChangesPer24h ?? 5;
  const suggestionTtlHours = config?.suggestionTtlHours ?? 24;

  if (product.demandVelocity > 0 && product.demandVelocity > (demandSpikeMultiplier * (categoryAverageVelocity || 1))) {
    triggers.push('DEMAND_SPIKE');
  }

  if (triggers.length === 0) return; // Nothing to do

  // Enforce max changes per product per 24h
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const changes24h = await PricingSuggestion.countDocuments({
    productId: product._id,
    createdAt: { $gte: since24h }
  });

  if (changes24h >= maxChangesPer24h) {
    console.log(`[AgentLoop] Max 24h changes limit reached (${changes24h}/${maxChangesPer24h}) for ${product.sku}. Skipping.`);
    try {
      await recordAICall({
        productId: product._id,
        sku: product.sku,
        category: product.category,
        triggerType: triggers[0],
        callType: 'pricing',
        outcome: 'rejected_by_policy',
        latencyMs: 0,
        fellBack: false,
        fallbackReason: null,
        inputDetails: {
          currentPrice: product.currentPrice,
          changes24h,
          maxChangesPer24h
        },
        outputDetails: {
          rejected: true,
          reason: `Max 24h change quota of ${maxChangesPer24h} reached (${changes24h} changes in last 24h)`
        }
      });
    } catch (e) {
      console.error('[AgentLoop] Quota rejection log error:', e.message);
    }
    return;
  }

  const strategy = await getActiveStrategy();
  const advisorName = config?.activeStrategy || 'rule-based';

  // Process each trigger
  for (const triggerReason of triggers) {
    const lockKey = `${product._id}_${triggerReason}`;
    if (inFlightLocks.has(lockKey)) {
      console.log(`[AgentLoop] Suggestion generation already in flight for ${product.sku} (${triggerReason}). Skipping.`);
      continue;
    }

    inFlightLocks.add(lockKey);
    try {
      // In-process check as an optimization before calling strategy
      const existingPricing = await PricingSuggestion.findOne({
        productId: product._id,
        triggerReason,
        status: 'PENDING'
      });

      const existingReorder = await ReorderSuggestion.findOne({
        productId: product._id,
        triggerReason,
        status: 'PENDING'
      });

      if (existingPricing && existingReorder) {
        console.log(`[AgentLoop] PENDING suggestions already exist for ${product.sku} (${triggerReason}). Skipping.`);
        continue;
      }

      // Record trigger firing event in instrumentation
      try {
        await recordTrigger({
          productId: product._id,
          sku: product.sku,
          category: product.category,
          triggerType: triggerReason,
          advisor: advisorName
        });
      } catch (logErr) {
        console.error('[AgentLoop] Metric log error:', logErr.message);
      }

      console.log(`[AgentLoop] Generating suggestions for ${product.sku} due to ${triggerReason}...`);

      const productVersion = product.__v ?? 0;
      const productUpdatedAt = product.updatedAt || new Date();
      const expiresAt = new Date(Date.now() + suggestionTtlHours * 60 * 60 * 1000);

      if (!existingPricing) {
        const pSuggestion = await strategy.suggestPricing(product, categoryAverageVelocity, triggerReason, { maxSingleChangePercent });
        
        let recommendedPrice = pSuggestion.recommendedPrice;
        let reasoning = pSuggestion.reasoning;
        const rawRecommendedPrice = pSuggestion.rawRecommendedPrice ?? pSuggestion.rawPrice ?? recommendedPrice;
        let wasClamped = Boolean(pSuggestion.wasClamped);
        let clampReason = pSuggestion.clampReasons ? pSuggestion.clampReasons.join('; ') : (pSuggestion.clampReason || null);

        // Fallback or external strategy additional clamp check if not already performed
        if (!wasClamped) {
          const maxDelta = product.currentPrice * (maxSingleChangePercent / 100);
          const maxAllowed = Math.round((product.currentPrice + maxDelta) * 100) / 100;
          const minAllowed = Math.round((product.currentPrice - maxDelta) * 100) / 100;

          if (recommendedPrice > maxAllowed) {
            recommendedPrice = maxAllowed;
            wasClamped = true;
            clampReason = `Clamped to max single change limit of +${maxSingleChangePercent}%`;
            reasoning += ` [${clampReason}]`;
          } else if (recommendedPrice < minAllowed) {
            recommendedPrice = minAllowed;
            wasClamped = true;
            clampReason = `Clamped to max single change limit of -${maxSingleChangePercent}%`;
            reasoning += ` [${clampReason}]`;
          }
        }

        const outcome = pSuggestion.isFallback
          ? 'FALLBACK'
          : (wasClamped ? 'clamped_by_policy' : (pSuggestion.outcome || 'success'));

        try {
          await PricingSuggestion.create({
            productId: product._id,
            currentPrice: product.currentPrice,
            recommendedPrice,
            rawRecommendedPrice,
            rawPrice: rawRecommendedPrice,
            wasClamped,
            clampReason,
            outcome,
            direction: pSuggestion.direction,
            confidence: pSuggestion.confidence,
            reasoning,
            status: 'PENDING',
            triggerReason,
            isFallback: Boolean(pSuggestion.isFallback),
            fallbackReason: pSuggestion.fallbackReason || null,
            priceVersion: product.priceVersion || 1,
            productVersion,
            productUpdatedAt,
            expiresAt
          });
        } catch (err) {
          if (isDuplicateKeyError(err)) {
            console.log(`[AgentLoop] Pricing suggestion already pending for ${product.sku} (${triggerReason}) (E11000). Skipping.`);
          } else {
            throw err;
          }
        }
      }

      if (!existingReorder) {
        const rSuggestion = await strategy.suggestReorder(product, triggerReason);
        if (rSuggestion && rSuggestion.recommendedQuantity >= 0) {
          const rawQuantity = rSuggestion.rawRecommendedQuantity ?? rSuggestion.rawQuantity ?? rSuggestion.recommendedQuantity;
          const outcome = rSuggestion.isFallback
            ? 'FALLBACK'
            : (rSuggestion.wasClamped ? 'clamped_by_policy' : (rSuggestion.outcome || 'success'));

          const safeStock = Math.max(0, product.stockLevel || 0);
          try {
            await ReorderSuggestion.create({
              productId: product._id,
              currentStock: safeStock,
              stockAtGeneration: safeStock,
              recommendedQuantity: rSuggestion.recommendedQuantity,
              rawRecommendedQuantity: rawQuantity,
              rawQuantity,
              wasClamped: Boolean(rSuggestion.wasClamped),
              clampReason: rSuggestion.clampReason || null,
              outcome,
              suggestedLeadTimeDays: rSuggestion.suggestedLeadTimeDays ?? 7,
              confidence: rSuggestion.confidence,
              reasoning: rSuggestion.reasoning,
              status: 'PENDING',
              triggerReason,
              isFallback: Boolean(rSuggestion.isFallback),
              fallbackReason: rSuggestion.fallbackReason || null,
              productVersion,
              productUpdatedAt,
              expiresAt
            });
          } catch (err) {
            if (isDuplicateKeyError(err)) {
              console.log(`[AgentLoop] Reorder suggestion already pending for ${product.sku} (${triggerReason}) (E11000). Skipping.`);
            } else {
              throw err;
            }
          }
        }
      }

      // Update product status
      await Product.findByIdAndUpdate(product._id, { status: 'PRICE_REVIEW_PENDING' });
    } finally {
      inFlightLocks.delete(lockKey);
    }
  }
}

inventoryEvents.on('inventory:changed', async (product) => {
  try {
    await processInventoryChange(product);
  } catch (error) {
    console.error(`[AgentLoop] Uncaught error in inventory:changed listener for ${product.sku}:`, error);
  }
});

/**
 * Wait for all active inFlightLocks to clear
 */
export async function waitForInFlightToClear(timeoutMs = 10000) {
  const start = Date.now();
  while (inFlightLocks.size > 0 && (Date.now() - start < timeoutMs)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Reconciliation sweep:
 * Finds products whose trigger conditions hold but have no PENDING suggestion,
 * and re-emits inventory:changed events for them.
 * The partial unique index on { productId, triggerReason } with status: 'PENDING'
 * ensures idempotency across concurrent sweeps and process restarts.
 */
export async function runReconciliationSweep(options = {}) {
  const config = await Config.findOne();
  const demandSpikeMultiplier = config?.demandSpikeMultiplier ?? 3;

  // 1. Calculate category average velocities
  const categoryAvgs = await Product.aggregate([
    { $group: { _id: '$category', avgVelocity: { $avg: '$demandVelocity' } } }
  ]);
  const catAvgMap = new Map(categoryAvgs.map(c => [c._id, c.avgVelocity || 0]));

  // 2. Scan all products for trigger conditions
  const products = await Product.find({});
  const reemittedProducts = [];

  for (const product of products) {
    const holds = [];
    if (product.stockLevel < product.reorderThreshold) {
      holds.push('INVENTORY_LOW');
    }

    const catAvg = catAvgMap.get(product.category) || 1;
    if (product.demandVelocity > 0 && product.demandVelocity > (demandSpikeMultiplier * catAvg)) {
      holds.push('DEMAND_SPIKE');
    }

    if (holds.length === 0) continue;

    // Check if any active trigger lacks pending suggestions
    let needsReconciliation = false;
    for (const triggerReason of holds) {
      const pendingPricing = await PricingSuggestion.findOne({ productId: product._id, triggerReason, status: 'PENDING' });
      if (!pendingPricing) {
        needsReconciliation = true;
        break;
      }
      if (triggerReason === 'INVENTORY_LOW') {
        const pendingReorder = await ReorderSuggestion.findOne({ productId: product._id, triggerReason, status: 'PENDING' });
        if (!pendingReorder) {
          needsReconciliation = true;
          break;
        }
      }
    }

    if (needsReconciliation) {
      console.log(`[Reconciliation] Trigger active without pending suggestion for ${product.sku} (${holds.join(', ')}). Re-emitting event.`);
      reemittedProducts.push(product);
      inventoryEvents.emit('inventory:changed', product);
    }
  }

  if (options.awaitProcessing) {
    await waitForInFlightToClear(options.timeoutMs || 10000);
  }

  return {
    scannedProducts: products.length,
    reconciledCount: reemittedProducts.length,
    reemittedProducts
  };
}

let reconciliationTimer = null;

/**
 * Start periodic reconciliation scheduler
 */
export function startReconciliationScheduler(intervalMs = 15 * 60 * 1000) {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  if (intervalMs && intervalMs > 0) {
    reconciliationTimer = setInterval(async () => {
      try {
        await runReconciliationSweep();
      } catch (err) {
        console.error('[Reconciliation] Error during scheduled reconciliation sweep:', err);
      }
    }, intervalMs);
    if (reconciliationTimer.unref) {
      reconciliationTimer.unref();
    }
  }
}

/**
 * Stop periodic reconciliation scheduler
 */
export function stopReconciliationScheduler() {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
}
