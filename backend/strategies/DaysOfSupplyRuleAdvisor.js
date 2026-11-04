import CommerceAdvisor from './CommerceAdvisor.js';

/**
 * DaysOfSupplyRuleAdvisor
 *
 * Implements standard retail inventory control theory: periodic-review order-up-to (R, S) policy.
 * Textbook formula:
 *   reorder quantity = ceil(max(0, velocityPerDay * (leadTimeDays + reviewPeriodDays) + safetyStock - currentStock))
 *
 * Parameters chosen up front (un-tuned baseline):
 *   - leadTimeDays: 7 (standard supplier lead time)
 *   - reviewPeriodDays: 7 (weekly review cycle)
 *   - safetyStockDays: 3 (safety buffer: safetyStock = ceil(velocityPerDay * 3))
 *   - protection period = leadTimeDays + reviewPeriodDays + safetyStockDays = 17 days of supply
 */
export class DaysOfSupplyRuleAdvisor extends CommerceAdvisor {
  constructor(options = {}) {
    super();
    this.leadTimeDays = options.leadTimeDays ?? 7;
    this.reviewPeriodDays = options.reviewPeriodDays ?? 7;
    this.safetyStockDays = options.safetyStockDays ?? 3;
  }

  async suggestPricing(product, categoryAverageVelocity, triggerReason) {
    let recommendedPrice = product.currentPrice;
    let direction = 'HOLD';
    let reasoning = 'No pricing rules fired. Holding current price.';
    
    const catAvg = categoryAverageVelocity || 1;

    if (product.stockLevel < product.reorderThreshold) {
      recommendedPrice = product.currentPrice * 1.10;
      direction = 'INCREASE';
      reasoning = 'Inventory is critically low; raising price by 10% to protect remaining stock.';
    } else if (product.demandVelocity > (2 * catAvg)) {
      recommendedPrice = product.currentPrice * 1.05;
      direction = 'INCREASE';
      reasoning = 'Demand is significantly higher than category average; raising price by 5%.';
    }

    // Margin floor clamp: max(cost * (1 + minMargin), 0.5 * current)
    let floorPrice = product.currentPrice * 0.5;
    if (product.costPrice != null && product.costPrice > 0) {
      const minMargin = product.minMarginPercent != null
        ? (product.minMarginPercent > 1 ? product.minMarginPercent / 100 : product.minMarginPercent)
        : 0;
      floorPrice = Math.max(product.costPrice * (1 + minMargin), 0.5 * product.currentPrice);
    }

    if (recommendedPrice < floorPrice) {
      recommendedPrice = floorPrice;
      reasoning += ` [Clamped to margin floor of $${floorPrice.toFixed(2)}]`;
    }

    // Ceiling clamp: 3x current price
    const ceilingPrice = product.currentPrice * 3;
    if (recommendedPrice > ceilingPrice) {
      recommendedPrice = ceilingPrice;
    }

    recommendedPrice = Math.round(recommendedPrice * 100) / 100;

    if (recommendedPrice > product.currentPrice) {
      direction = 'INCREASE';
    } else if (recommendedPrice < product.currentPrice) {
      direction = 'DECREASE';
    } else {
      direction = 'HOLD';
    }

    return {
      recommendedPrice,
      direction,
      confidence: 0.75,
      reasoning
    };
  }

  async suggestReorder(product, triggerReason) {
    const velocity = Number(product.demandVelocity || 0);
    const stock = Number(product.stockLevel || 0);
    const threshold = Number(product.reorderThreshold || 10);
    
    // Textbook formula:
    // targetStock = ceil(velocity * (leadTimeDays + reviewPeriodDays) + safetyStock)
    const safetyStock = Math.ceil(velocity * this.safetyStockDays);
    const targetStock = Math.ceil(velocity * (this.leadTimeDays + this.reviewPeriodDays) + safetyStock);
    let recommendedQuantity = Math.ceil(Math.max(0, targetStock - stock));

    // When critically out of stock (stock == 0) and velocity is low, replenish at least to reorderThreshold
    if (stock === 0 && recommendedQuantity < threshold) {
      recommendedQuantity = threshold;
    }

    // Sensible upper bound clamp
    const maxBound = Math.max(threshold * 20, 10000);
    if (recommendedQuantity > maxBound) {
      recommendedQuantity = maxBound;
    }

    return {
      recommendedQuantity,
      suggestedLeadTimeDays: this.leadTimeDays,
      confidence: 0.75,
      reasoning: `Textbook Days-of-Supply replenishment: target coverage = ${this.leadTimeDays + this.reviewPeriodDays + this.safetyStockDays} days (${targetStock} units) - on hand ${stock} units = ${recommendedQuantity} units.`
    };
  }
}

export default DaysOfSupplyRuleAdvisor;
