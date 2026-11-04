import inventoryEvents from '../events/inventoryEvents.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import { getActiveStrategy } from '../strategies/registry.js';
import Config from '../models/Config.js';
import { recordTrigger } from './metrics.js';

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
        const pSuggestion = await strategy.suggestPricing(product, categoryAverageVelocity, triggerReason);
        
        // Enforce max single change percent clamp
        let recommendedPrice = pSuggestion.recommendedPrice;
        let reasoning = pSuggestion.reasoning;
        const maxDelta = product.currentPrice * (maxSingleChangePercent / 100);
        const maxAllowed = Math.round((product.currentPrice + maxDelta) * 100) / 100;
        const minAllowed = Math.round((product.currentPrice - maxDelta) * 100) / 100;

        if (recommendedPrice > maxAllowed) {
          recommendedPrice = maxAllowed;
          reasoning += ` [Clamped to max single change limit of +${maxSingleChangePercent}%]`;
        } else if (recommendedPrice < minAllowed) {
          recommendedPrice = minAllowed;
          reasoning += ` [Clamped to max single change limit of -${maxSingleChangePercent}%]`;
        }

        try {
          await PricingSuggestion.create({
            productId: product._id,
            currentPrice: product.currentPrice,
            recommendedPrice,
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
        try {
          await ReorderSuggestion.create({
            productId: product._id,
            currentStock: product.stockLevel,
            stockAtGeneration: product.stockLevel,
            recommendedQuantity: rSuggestion.recommendedQuantity,
            suggestedLeadTimeDays: rSuggestion.suggestedLeadTimeDays,
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
