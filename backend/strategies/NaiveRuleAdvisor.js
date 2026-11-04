import CommerceAdvisor from './CommerceAdvisor.js';

class NaiveRuleAdvisor extends CommerceAdvisor {
  async suggestPricing(product, categoryAverageVelocity, triggerReason) {
    let recommendedPrice = product.currentPrice;
    let direction = 'HOLD';
    let reasoning = 'No pricing rules fired. Holding current price.';
    
    const catAvg = categoryAverageVelocity || 1;

    if (product.stockLevel < product.reorderThreshold) {
      recommendedPrice = product.currentPrice * 1.10; // 10% increase
      direction = 'INCREASE';
      reasoning = 'Inventory is critically low; raising price by 10% to protect remaining stock.';
    } else if (product.demandVelocity > (2 * catAvg)) {
      recommendedPrice = product.currentPrice * 1.05; // 5% increase
      direction = 'INCREASE';
      reasoning = 'Demand is significantly higher than category average; raising price by 5%.';
    }

    // Floor clamp: max(cost * (1 + minMargin), 0.5 * current)
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

    // Round to 2 decimals
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
      confidence: 0.6,
      reasoning
    };
  }

  async suggestReorder(product, triggerReason) {
    // Naive threshold * 2 replenishment rule
    const threshold = Number(product.reorderThreshold || 10);
    const stock = Number(product.stockLevel || 0);
    const recommendedQuantity = Math.max(0, (threshold * 2) - stock);
    
    return {
      recommendedQuantity,
      suggestedLeadTimeDays: 7,
      confidence: 0.6,
      reasoning: `Naive threshold * 2 replenishment rule (${threshold * 2} - ${stock} = ${recommendedQuantity}).`
    };
  }
}

export default NaiveRuleAdvisor;
