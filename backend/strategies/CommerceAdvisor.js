class CommerceAdvisor {
  /**
   * @param {Object} product 
   * @param {Number} categoryAverageVelocity 
   * @param {String} triggerReason 
   * @returns {Promise<{recommendedPrice: number, direction: string, confidence: number, reasoning: string}>}
   */
  async suggestPricing(product, categoryAverageVelocity, triggerReason) {
    throw new Error('suggestPricing not implemented');
  }

  /**
   * @param {Object} product 
   * @param {String} triggerReason 
   * @returns {Promise<{recommendedQuantity: number, suggestedLeadTimeDays: number, confidence: number, reasoning: string}>}
   */
  async suggestReorder(product, triggerReason) {
    throw new Error('suggestReorder not implemented');
  }
}

export default CommerceAdvisor;
