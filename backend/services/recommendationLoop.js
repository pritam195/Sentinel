import inventoryEvents from '../events/inventoryEvents.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import { getActiveStrategy } from '../strategies/registry.js';
import Config from '../models/Config.js';
import { recordTrigger } from './metrics.js';

// In-flight mutex set to prevent race conditions during concurrent events for the same product & trigger
const inFlightLocks = new Set();

inventoryEvents.on('inventory:changed', async (product) => {
  try {
    // 1. Calculate category average velocity
    const categoryProducts = await Product.find({ category: product.category });
    const totalVelocity = categoryProducts.reduce((sum, p) => sum + p.demandVelocity, 0);
    const categoryAverageVelocity = categoryProducts.length > 0 ? totalVelocity / categoryProducts.length : 0;

    const triggers = [];

    // Trigger A: Inventory Low
    if (product.stockLevel < product.reorderThreshold) {
      triggers.push('INVENTORY_LOW');
    }

    // Trigger B: Demand Spike (velocity > 3 * category avg)
    // Avoid triggering on 0 average by ensuring at least some velocity
    const config = await Config.findOne();
    const demandSpikeMultiplier = config?.demandSpikeMultiplier ?? 3;
    if (product.demandVelocity > 0 && product.demandVelocity > (demandSpikeMultiplier * (categoryAverageVelocity || 1))) {
      triggers.push('DEMAND_SPIKE');
    }

    if (triggers.length === 0) return; // Nothing to do

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
        // Enforce Idempotency for Pricing
        const existingPricing = await PricingSuggestion.findOne({
          productId: product._id,
          triggerReason,
          status: 'PENDING'
        });

        // Enforce Idempotency for Reorder
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

        if (!existingPricing) {
          const pSuggestion = await strategy.suggestPricing(product, categoryAverageVelocity, triggerReason);
          await PricingSuggestion.create({
            productId: product._id,
            currentPrice: product.currentPrice,
            recommendedPrice: pSuggestion.recommendedPrice,
            direction: pSuggestion.direction,
            confidence: pSuggestion.confidence,
            reasoning: pSuggestion.reasoning,
            status: 'PENDING',
            triggerReason
          });
        }

        if (!existingReorder) {
          const rSuggestion = await strategy.suggestReorder(product, triggerReason);
          await ReorderSuggestion.create({
            productId: product._id,
            currentStock: product.stockLevel,
            recommendedQuantity: rSuggestion.recommendedQuantity,
            suggestedLeadTimeDays: rSuggestion.suggestedLeadTimeDays,
            confidence: rSuggestion.confidence,
            reasoning: rSuggestion.reasoning,
            status: 'PENDING',
            triggerReason
          });
        }

        // Update product status
        await Product.findByIdAndUpdate(product._id, { status: 'PRICE_REVIEW_PENDING' });
      } finally {
        inFlightLocks.delete(lockKey);
      }
    }
  } catch (error) {
    console.error(`[AgentLoop] Uncaught error in inventory:changed listener for ${product.sku}:`, error);
  }
});
