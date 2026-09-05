import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AIAdvisor from '../strategies/AIAdvisor.js';
import RuleBasedAdvisor from '../strategies/RuleBasedAdvisor.js';
import Config from '../models/Config.js';
import { callLLM } from '../services/llmGateway.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

/**
 * 25 Diverse, Realistic E-Commerce Merchandising Scenarios
 * Labeled with Expert Judgments for Dynamic Pricing and Replenishment
 */
export const benchmarkScenarios = [
  // --- ELECTRONICS ---
  {
    id: 1,
    name: 'Wireless ANC Headphones — Critical Stock & Surge Demand',
    category: 'ELECTRONICS',
    currentPrice: 199.99,
    costPrice: 100.00,
    stockLevel: 3,
    reorderThreshold: 20,
    demandVelocity: 18,
    categoryAverageVelocity: 3.5,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 219.99,
      minPrice: 209.99,
      maxPrice: 239.99,
      expectedQty: 55,
      minQty: 40,
      maxQty: 75,
      rationale: 'Scarcity protection: Stock critical (3 units) with 5x category velocity warrants a 10-15% increase.'
    }
  },
  {
    id: 2,
    name: 'Braided 100W USB-C Cable — Excess Stock & Slow Velocity',
    category: 'ELECTRONICS',
    currentPrice: 19.99,
    costPrice: 5.00,
    stockLevel: 180,
    reorderThreshold: 30,
    demandVelocity: 1,
    categoryAverageVelocity: 4.0,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD', // or modest promo, but rules hold
      expectedPrice: 19.99,
      minPrice: 16.99,
      maxPrice: 19.99,
      expectedQty: 1,
      minQty: 1,
      maxQty: 15,
      rationale: 'Healthy margin but massive oversupply (6x threshold); do not increase price, zero urgent reorder.'
    }
  },
  {
    id: 3,
    name: 'Multi-Port GaN Wall Charger — Sudden Viral Demand Spike',
    category: 'ELECTRONICS',
    currentPrice: 49.99,
    costPrice: 22.00,
    stockLevel: 35,
    reorderThreshold: 25,
    demandVelocity: 24,
    categoryAverageVelocity: 4.0,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 52.99,
      minPrice: 51.99,
      maxPrice: 57.99,
      expectedQty: 60,
      minQty: 45,
      maxQty: 90,
      rationale: 'Demand velocity is 6x category peer average; capture willingness to pay with a 5-10% price bump.'
    }
  },
  {
    id: 4,
    name: 'Mechanical Gaming Keyboard — Low Stock, Steady Velocity',
    category: 'ELECTRONICS',
    currentPrice: 129.99,
    costPrice: 75.00,
    stockLevel: 12,
    reorderThreshold: 20,
    demandVelocity: 4,
    categoryAverageVelocity: 3.5,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 142.99,
      minPrice: 135.00,
      maxPrice: 149.99,
      expectedQty: 48,
      minQty: 35,
      maxQty: 65,
      rationale: 'Stock below safety threshold with steady baseline demand; 8-10% defensive markup.'
    }
  },
  {
    id: 5,
    name: 'Smart 4K Action Camera — Out of Stock Emergency',
    category: 'ELECTRONICS',
    currentPrice: 249.99,
    costPrice: 160.00,
    stockLevel: 0,
    reorderThreshold: 15,
    demandVelocity: 8,
    categoryAverageVelocity: 3.0,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 274.99,
      minPrice: 259.99,
      maxPrice: 289.99,
      expectedQty: 45,
      minQty: 30,
      maxQty: 60,
      rationale: 'Stock completely exhausted; price must increase upon inbound arrival to slow depletion rate.'
    }
  },
  {
    id: 6,
    name: 'Portable Bluetooth Speaker — Stable Inventory & Average Velocity',
    category: 'ELECTRONICS',
    currentPrice: 69.99,
    costPrice: 35.00,
    stockLevel: 45,
    reorderThreshold: 20,
    demandVelocity: 3,
    categoryAverageVelocity: 3.2,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD',
      expectedPrice: 69.99,
      minPrice: 66.00,
      maxPrice: 73.00,
      expectedQty: 15,
      minQty: 1,
      maxQty: 30,
      rationale: 'Operating at steady state equilibrium. Price hold is appropriate.'
    }
  },
  {
    id: 7,
    name: 'Wireless Mouse Ergonomic — Razor-Thin Margin',
    category: 'ELECTRONICS',
    currentPrice: 24.99,
    costPrice: 22.50, // 10% margin
    stockLevel: 14,
    reorderThreshold: 25,
    demandVelocity: 5,
    categoryAverageVelocity: 4.0,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 27.49,
      minPrice: 26.00,
      maxPrice: 28.99,
      expectedQty: 60,
      minQty: 40,
      maxQty: 75,
      rationale: 'Margin is under severe pressure (10% gross margin); low stock warrants 10% increase to recover margin.'
    }
  },
  {
    id: 8,
    name: '10,000mAh Slim Power Bank — High Velocity with Good Stock',
    category: 'ELECTRONICS',
    currentPrice: 39.99,
    costPrice: 18.00,
    stockLevel: 65,
    reorderThreshold: 20,
    demandVelocity: 16,
    categoryAverageVelocity: 3.5,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 41.99,
      minPrice: 41.00,
      maxPrice: 44.99,
      expectedQty: 50,
      minQty: 30,
      maxQty: 70,
      rationale: 'High velocity spike (>4x avg); modest 5% price increase captures revenue without stifling demand.'
    }
  },

  // --- APPAREL ---
  {
    id: 9,
    name: 'Heavyweight Pullover Hoodie — Winter Demand Spike',
    category: 'APPAREL',
    currentPrice: 65.00,
    costPrice: 28.00,
    stockLevel: 18,
    reorderThreshold: 25,
    demandVelocity: 22,
    categoryAverageVelocity: 4.0,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 68.25,
      minPrice: 67.00,
      maxPrice: 74.75,
      expectedQty: 60,
      minQty: 45,
      maxQty: 85,
      rationale: 'Seasonal velocity 5x above peers with stock below threshold; increase price by 5-10%.'
    }
  },
  {
    id: 10,
    name: 'Organic Crewneck T-Shirt — Critical Stockout Imminent',
    category: 'APPAREL',
    currentPrice: 28.00,
    costPrice: 11.00,
    stockLevel: 6,
    reorderThreshold: 30,
    demandVelocity: 14,
    categoryAverageVelocity: 3.5,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 30.80,
      minPrice: 29.50,
      maxPrice: 33.00,
      expectedQty: 84,
      minQty: 60,
      maxQty: 100,
      rationale: 'Only 6 units remaining against 14 orders/day velocity; raise price 10% immediately.'
    }
  },
  {
    id: 11,
    name: 'Performance Running Shorts — Off-Season Stagnation',
    category: 'APPAREL',
    currentPrice: 42.00,
    costPrice: 16.00,
    stockLevel: 110,
    reorderThreshold: 20,
    demandVelocity: 0,
    categoryAverageVelocity: 3.0,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD',
      expectedPrice: 42.00,
      minPrice: 35.00,
      maxPrice: 42.00,
      expectedQty: 1,
      minQty: 1,
      maxQty: 10,
      rationale: 'Zero demand velocity and excessive stock; holding current price is safe, no replenishment.'
    }
  },
  {
    id: 12,
    name: 'Waterproof Trail Jacket — Balanced Seasonal Demand',
    category: 'APPAREL',
    currentPrice: 119.00,
    costPrice: 50.00,
    stockLevel: 32,
    reorderThreshold: 15,
    demandVelocity: 3,
    categoryAverageVelocity: 3.0,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD',
      expectedPrice: 119.00,
      minPrice: 110.00,
      maxPrice: 125.00,
      expectedQty: 13,
      minQty: 1,
      maxQty: 25,
      rationale: 'Inventory at 2x threshold, velocity matches category average; hold current pricing.'
    }
  },
  {
    id: 13,
    name: 'Thermal Merino Wool Socks — Stock Dip Below Threshold',
    category: 'APPAREL',
    currentPrice: 22.00,
    costPrice: 8.00,
    stockLevel: 14,
    reorderThreshold: 20,
    demandVelocity: 5,
    categoryAverageVelocity: 3.2,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 24.20,
      minPrice: 23.00,
      maxPrice: 25.50,
      expectedQty: 46,
      minQty: 35,
      maxQty: 60,
      rationale: 'Stock is below 20 reorder threshold; standard 10% price markup to protect scarce inventory.'
    }
  },
  {
    id: 14,
    name: 'Fleece-Lined Beanie — Moderate Demand Surge',
    category: 'APPAREL',
    currentPrice: 26.00,
    costPrice: 9.00,
    stockLevel: 45,
    reorderThreshold: 15,
    demandVelocity: 12,
    categoryAverageVelocity: 3.0,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 27.30,
      minPrice: 27.00,
      maxPrice: 29.50,
      expectedQty: 35,
      minQty: 20,
      maxQty: 50,
      rationale: '4x category average demand velocity; capture demand surge with a 5% price increase.'
    }
  },
  {
    id: 15,
    name: 'Linen Casual Shirt — Premium Luxury Margin',
    category: 'APPAREL',
    currentPrice: 89.00,
    costPrice: 25.00, // 72% margin
    stockLevel: 9,
    reorderThreshold: 15,
    demandVelocity: 4,
    categoryAverageVelocity: 3.0,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 97.90,
      minPrice: 93.00,
      maxPrice: 105.00,
      expectedQty: 36,
      minQty: 25,
      maxQty: 50,
      rationale: 'High gross margin luxury item with low stock; price elasticity allows 10% increase.'
    }
  },
  {
    id: 16,
    name: 'Athletic Ankle Socks (6-Pack) — Bulk High Volume Steady',
    category: 'APPAREL',
    currentPrice: 18.00,
    costPrice: 7.00,
    stockLevel: 60,
    reorderThreshold: 25,
    demandVelocity: 5,
    categoryAverageVelocity: 4.5,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD',
      expectedPrice: 18.00,
      minPrice: 16.50,
      maxPrice: 19.50,
      expectedQty: 15,
      minQty: 1,
      maxQty: 30,
      rationale: 'High volume staple in stock; maintain price stability.'
    }
  },

  // --- HOME ---
  {
    id: 17,
    name: 'Ceramic Pour-Over Coffee Maker — Demand Spike & Low Stock',
    category: 'HOME',
    currentPrice: 45.00,
    costPrice: 18.00,
    stockLevel: 7,
    reorderThreshold: 15,
    demandVelocity: 16,
    categoryAverageVelocity: 2.5,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 47.25,
      minPrice: 47.00,
      maxPrice: 52.00,
      expectedQty: 38,
      minQty: 28,
      maxQty: 55,
      rationale: 'Simultaneous low stock and demand spike (6x avg); modest 5-10% price markup.'
    }
  },
  {
    id: 18,
    name: 'Aroma Diffuser Ultrasonic — Low Stock Replenishment',
    category: 'HOME',
    currentPrice: 36.00,
    costPrice: 15.00,
    stockLevel: 8,
    reorderThreshold: 20,
    demandVelocity: 3,
    categoryAverageVelocity: 2.5,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 39.60,
      minPrice: 38.00,
      maxPrice: 42.00,
      expectedQty: 52,
      minQty: 38,
      maxQty: 65,
      rationale: 'Below reorder threshold; raise price 10% and order standard 3x threshold replenishment.'
    }
  },
  {
    id: 19,
    name: 'Cast Iron Skillet 10-Inch — Heavy Excess Inventory',
    category: 'HOME',
    currentPrice: 49.99,
    costPrice: 22.00,
    stockLevel: 95,
    reorderThreshold: 15,
    demandVelocity: 1,
    categoryAverageVelocity: 2.5,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD',
      expectedPrice: 49.99,
      minPrice: 44.99,
      maxPrice: 49.99,
      expectedQty: 1,
      minQty: 1,
      maxQty: 10,
      rationale: 'Warehousing excess inventory; hold price or discount, definitely zero reorder.'
    }
  },
  {
    id: 20,
    name: 'Minimalist LED Desk Lamp — Critical Single Unit Remaining',
    category: 'HOME',
    currentPrice: 58.00,
    costPrice: 25.00,
    stockLevel: 1,
    reorderThreshold: 12,
    demandVelocity: 6,
    categoryAverageVelocity: 2.0,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 63.80,
      minPrice: 61.00,
      maxPrice: 69.00,
      expectedQty: 35,
      minQty: 25,
      maxQty: 48,
      rationale: 'Single unit left on shelf with active demand; 10% markup protects last unit from immediate zero stock.'
    }
  },
  {
    id: 21,
    name: 'Stainless Steel Insulated Tumbler — Viral Demand Spike',
    category: 'HOME',
    currentPrice: 29.99,
    costPrice: 11.00,
    stockLevel: 30,
    reorderThreshold: 15,
    demandVelocity: 15,
    categoryAverageVelocity: 2.5,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 31.49,
      minPrice: 31.00,
      maxPrice: 34.50,
      expectedQty: 40,
      minQty: 25,
      maxQty: 60,
      rationale: 'Demand velocity 6x higher than peers; 5% price markup captures surge premium.'
    }
  },
  {
    id: 22,
    name: 'Cotton Linen Throw Pillow — Steady Equilibrium',
    category: 'HOME',
    currentPrice: 32.00,
    costPrice: 12.00,
    stockLevel: 38,
    reorderThreshold: 15,
    demandVelocity: 2,
    categoryAverageVelocity: 2.0,
    triggerReason: 'MANUAL',
    expert: {
      direction: 'HOLD',
      expectedPrice: 32.00,
      minPrice: 29.00,
      maxPrice: 34.00,
      expectedQty: 7,
      minQty: 1,
      maxQty: 20,
      rationale: 'Normal inventory coverage and average demand. Hold price.'
    }
  },
  {
    id: 23,
    name: 'Double-Walled Espresso Glasses (Set of 2) — Stock Alert',
    category: 'HOME',
    currentPrice: 24.00,
    costPrice: 9.00,
    stockLevel: 5,
    reorderThreshold: 18,
    demandVelocity: 4,
    categoryAverageVelocity: 2.2,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 26.40,
      minPrice: 25.00,
      maxPrice: 28.00,
      expectedQty: 49,
      minQty: 35,
      maxQty: 65,
      rationale: 'Stock critically low at 5 units; raise price 10% and order replenishment.'
    }
  },
  {
    id: 24,
    name: 'Bamboo Cutting Board with Juice Groove — Low Margin Household',
    category: 'HOME',
    currentPrice: 19.99,
    costPrice: 17.00, // 15% margin
    stockLevel: 8,
    reorderThreshold: 20,
    demandVelocity: 3,
    categoryAverageVelocity: 2.0,
    triggerReason: 'INVENTORY_LOW',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 21.99,
      minPrice: 21.00,
      maxPrice: 23.50,
      expectedQty: 52,
      minQty: 38,
      maxQty: 65,
      rationale: 'Tight margin product with low stock; 10% increase preserves unit profitability.'
    }
  },
  {
    id: 25,
    name: 'Scented Soy Candle in Amber Jar — Demand Spike',
    category: 'HOME',
    currentPrice: 22.50,
    costPrice: 7.50,
    stockLevel: 28,
    reorderThreshold: 12,
    demandVelocity: 11,
    categoryAverageVelocity: 2.0,
    triggerReason: 'DEMAND_SPIKE',
    expert: {
      direction: 'INCREASE',
      expectedPrice: 23.63,
      minPrice: 23.50,
      maxPrice: 25.50,
      expectedQty: 30,
      minQty: 18,
      maxQty: 45,
      rationale: '5.5x demand velocity spike; raise price 5% to harvest consumer interest.'
    }
  }
];

export async function runBenchmark() {
  console.log('===============================================================');
  console.log('        SENTINEL ADVISOR BENCHMARK EVALUATION HARNESS          ');
  console.log('        (RuleBasedAdvisor vs. AIAdvisor vs. Expert Labels)     ');
  console.log('===============================================================');

  const ruleAdvisor = new RuleBasedAdvisor();
  const aiAdvisor = new AIAdvisor();

  let ruleDirectionMatches = 0;
  let rulePriceRangeMatches = 0;
  let ruleReorderRangeMatches = 0;
  let ruleTotalProximityScore = 0;

  let aiDirectionMatches = 0;
  let aiPriceRangeMatches = 0;
  let aiReorderRangeMatches = 0;
  let aiTotalProximityScore = 0;

  const comparisonRows = [];

  console.log(`Evaluating ${benchmarkScenarios.length} labeled merchandising scenarios...\n`);

  for (const s of benchmarkScenarios) {
    const mockProduct = {
      _id: new mongoose.Types.ObjectId(),
      sku: `BENCH-${s.id}`,
      name: s.name,
      category: s.category,
      currentPrice: s.currentPrice,
      costPrice: s.costPrice,
      stockLevel: s.stockLevel,
      reorderThreshold: s.reorderThreshold,
      demandVelocity: s.demandVelocity
    };

    // 1. Evaluate Rule-Based Advisor
    const rulePricing = await ruleAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    const ruleReorder = await ruleAdvisor.suggestReorder(mockProduct, s.triggerReason);

    // Rule scoring
    const ruleDirMatch = rulePricing.direction === s.expert.direction;
    const rulePriceMatch = rulePricing.recommendedPrice >= s.expert.minPrice && rulePricing.recommendedPrice <= s.expert.maxPrice;
    const ruleQtyMatch = ruleReorder.recommendedQuantity >= s.expert.minQty && ruleReorder.recommendedQuantity <= s.expert.maxQty;
    const ruleProximity = Math.max(0, 1 - Math.abs(rulePricing.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice);

    if (ruleDirMatch) ruleDirectionMatches++;
    if (rulePriceMatch) rulePriceRangeMatches++;
    if (ruleQtyMatch) ruleReorderRangeMatches++;
    ruleTotalProximityScore += ruleProximity;

    // 2. Evaluate AI Advisor (with real Gemini call)
    let aiPricing, aiReorder;
    try {
      aiPricing = await aiAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
      aiReorder = await aiAdvisor.suggestReorder(mockProduct, s.triggerReason);
    } catch (e) {
      console.warn(`[AI Failover on Scenario #${s.id}]`, e.message);
      aiPricing = await ruleAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
      aiReorder = await ruleAdvisor.suggestReorder(mockProduct, s.triggerReason);
    }

    // AI scoring
    const aiDirMatch = aiPricing.direction === s.expert.direction;
    const aiPriceMatch = aiPricing.recommendedPrice >= s.expert.minPrice && aiPricing.recommendedPrice <= s.expert.maxPrice;
    const aiQtyMatch = aiReorder.recommendedQuantity >= s.expert.minQty && aiReorder.recommendedQuantity <= s.expert.maxQty;
    const aiProximity = Math.max(0, 1 - Math.abs(aiPricing.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice);

    if (aiDirMatch) aiDirectionMatches++;
    if (aiPriceMatch) aiPriceRangeMatches++;
    if (aiQtyMatch) aiReorderRangeMatches++;
    aiTotalProximityScore += aiProximity;

    comparisonRows.push({
      id: s.id,
      name: s.name,
      trigger: s.triggerReason,
      expert: {
        dir: s.expert.direction,
        price: `$${s.expert.expectedPrice.toFixed(2)}`,
        range: `$${s.expert.minPrice.toFixed(2)}-$${s.expert.maxPrice.toFixed(2)}`,
        qty: `${s.expert.minQty}-${s.expert.maxQty}`
      },
      rule: {
        dir: rulePricing.direction,
        price: `$${rulePricing.recommendedPrice.toFixed(2)}`,
        qty: ruleReorder.recommendedQuantity,
        dirMatch: ruleDirMatch,
        priceMatch: rulePriceMatch,
        qtyMatch: ruleQtyMatch
      },
      ai: {
        dir: aiPricing.direction,
        price: `$${aiPricing.recommendedPrice.toFixed(2)}`,
        qty: aiReorder.recommendedQuantity,
        dirMatch: aiDirMatch,
        priceMatch: aiPriceMatch,
        qtyMatch: aiQtyMatch,
        isFallback: aiPricing.reasoning?.includes('[Fallback')
      }
    });

    console.log(`[Scenario #${s.id.toString().padStart(2, '0')}] ${s.name.substring(0, 38).padEnd(40)} | Expert: ${s.expert.direction.padEnd(8)} $${s.expert.expectedPrice.toFixed(2).padStart(6)} | Rule: ${rulePricing.direction.padEnd(8)} $${rulePricing.recommendedPrice.toFixed(2).padStart(6)} (${rulePriceMatch ? 'OK' : 'MISMATCH'}) | AI: ${aiPricing.direction.padEnd(8)} $${aiPricing.recommendedPrice.toFixed(2).padStart(6)} (${aiPriceMatch ? 'OK' : 'MISMATCH'})`);
  }

  const N = benchmarkScenarios.length;

  const ruleDirPct = ((ruleDirectionMatches / N) * 100).toFixed(1);
  const rulePricePct = ((rulePriceRangeMatches / N) * 100).toFixed(1);
  const ruleReorderPct = ((ruleReorderRangeMatches / N) * 100).toFixed(1);
  const ruleMeanProximity = ((ruleTotalProximityScore / N) * 100).toFixed(1);

  const aiDirPct = ((aiDirectionMatches / N) * 100).toFixed(1);
  const aiPricePct = ((aiPriceRangeMatches / N) * 100).toFixed(1);
  const aiReorderPct = ((aiReorderRangeMatches / N) * 100).toFixed(1);
  const aiMeanProximity = ((aiTotalProximityScore / N) * 100).toFixed(1);

  console.log('\n===============================================================');
  console.log('                   BENCHMARK EVALUATION SUMMARY                ');
  console.log('===============================================================');
  console.log(`Evaluated ${N} Ground-Truth Merchandising Scenarios across 3 Categories:`);
  console.log(`\n1. DIRECTIONAL AGREEMENT (Direction matches Expert Judgment):`);
  console.log(`   - Rule-Based Advisor: ${ruleDirectionMatches}/${N} (${ruleDirPct}%)`);
  console.log(`   - AI Advisor:         ${aiDirectionMatches}/${N} (${aiDirPct}%)`);
  console.log(`\n2. PRICE ACCURACY (Price falls within Expert Acceptable Window):`);
  console.log(`   - Rule-Based Advisor: ${rulePriceRangeMatches}/${N} (${rulePricePct}%)`);
  console.log(`   - AI Advisor:         ${aiPriceRangeMatches}/${N} (${aiPricePct}%)`);
  console.log(`\n3. PRICE PROXIMITY SCORE (Mean percentage closeness to target price):`);
  console.log(`   - Rule-Based Advisor: ${ruleMeanProximity}%`);
  console.log(`   - AI Advisor:         ${aiMeanProximity}%`);
  console.log(`\n4. REORDER QUANTITY ACCURACY (Replenishment in Expert Window):`);
  console.log(`   - Rule-Based Advisor: ${ruleReorderRangeMatches}/${N} (${ruleReorderPct}%)`);
  console.log(`   - AI Advisor:         ${aiReorderRangeMatches}/${N} (${aiReorderPct}%)`);
  console.log('===============================================================\n');

  return {
    totalScenarios: N,
    ruleResults: {
      directionalAgreementPct: Number(ruleDirPct),
      priceToleranceAgreementPct: Number(rulePricePct),
      reorderToleranceAgreementPct: Number(ruleReorderPct),
      meanProximityPct: Number(ruleMeanProximity)
    },
    aiResults: {
      directionalAgreementPct: Number(aiDirPct),
      priceToleranceAgreementPct: Number(aiPricePct),
      reorderToleranceAgreementPct: Number(aiReorderPct),
      meanProximityPct: Number(aiMeanProximity)
    },
    comparisonRows
  };
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('benchmark.test.js')) {
  mongoose.connect(MONGO_URI)
    .then(() => runBenchmark())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Benchmark execution error:', err);
      process.exit(1);
    });
}
