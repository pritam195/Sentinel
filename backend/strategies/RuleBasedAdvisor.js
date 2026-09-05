import CommerceAdvisor from './CommerceAdvisor.js';

class RuleBasedAdvisor extends CommerceAdvisor {
  async suggestPricing(product, categoryAverageVelocity, triggerReason) {
    let recommendedPrice = product.currentPrice;
    let direction = 'HOLD';
    let reasoning = 'No pricing rules fired. Holding current price.';
    
    // Fallback if categoryAverageVelocity is not provided or 0
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

    // Round to 2 decimals
    recommendedPrice = Math.round(recommendedPrice * 100) / 100;

    return {
      recommendedPrice,
      direction,
      confidence: 0.6,
      reasoning
    };
  }

  async suggestReorder(product, triggerReason) {
    const recommendedQuantity = Math.max(1, (product.reorderThreshold * 3) - product.stockLevel);
    
    return {
      recommendedQuantity,
      suggestedLeadTimeDays: 7,
      confidence: 0.6,
      reasoning: 'Standard rule-based replenishment calculated from reorder threshold.'
    };
  }
}

export default RuleBasedAdvisor;
