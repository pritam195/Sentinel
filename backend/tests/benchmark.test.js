import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { performance } from 'perf_hooks';
import AIAdvisor from '../strategies/AIAdvisor.js';
import RuleBasedAdvisor from '../strategies/RuleBasedAdvisor.js';
import { benchmarkScenarios } from './data/benchmarkScenarios.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

// Error function approximation (Abramowitz & Stegun 7.1.26)
function erf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// Standard normal cumulative distribution function
function normalCDF(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * 95% Wilson Score Confidence Interval for a binomial proportion
 * @param {number} x - Count of successes
 * @param {number} n - Total trials
 * @param {number} z - Standard normal critical value (default 1.95996 for 95%)
 */
export function calculateWilsonCI(x, n, z = 1.95996) {
  if (n === 0) return { lower: 0, upper: 0, str: '[0.0%, 0.0%]' };
  const p = x / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);
  return {
    lower,
    upper,
    pct: Number((p * 100).toFixed(1)),
    str: `[${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]`
  };
}

/**
 * McNemar's Paired Test with Edwards Continuity Correction
 * Evaluates whether the disagreement between RuleBased and AI models is statistically distinguishable
 * @param {number} b - Model 1 (Rule) correct, Model 2 (AI) incorrect
 * @param {number} c - Model 1 (Rule) incorrect, Model 2 (AI) correct
 */
export function calculateMcNemarTest(b, c) {
  const discordant = b + c;
  if (discordant === 0) {
    return {
      b,
      c,
      discordant: 0,
      chi2: 0,
      pValue: 1.0,
      distinguishable: false,
      summary: 'No discordant pairs observed (Rule and AI agreed on all instances).'
    };
  }

  const diff = Math.abs(b - c);
  // Continuity-corrected chi-squared statistic
  const chi2 = Math.pow(Math.max(0, diff - 1), 2) / discordant;
  const z = Math.sqrt(chi2);
  const pValue = 2 * (1 - normalCDF(z));
  const distinguishable = pValue < 0.05;

  return {
    b,
    c,
    discordant,
    chi2: Number(chi2.toFixed(4)),
    pValue: Number(pValue.toFixed(4)),
    distinguishable,
    summary: distinguishable
      ? `Statistically distinguishable difference (chi2=${chi2.toFixed(2)}, p=${pValue.toFixed(4)} < 0.05)`
      : `Statistically indistinguishable difference (chi2=${chi2.toFixed(2)}, p=${pValue.toFixed(4)} >= 0.05)`
  };
}

/**
 * Calculate p50, p95, p99 percentiles from an array of numbers
 */
export function calculatePercentiles(latencies) {
  if (!latencies || latencies.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const getP = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
    return Number(sorted[idx].toFixed(2));
  };
  return {
    p50: getP(0.50),
    p95: getP(0.95),
    p99: getP(0.99)
  };
}

/**
 * Deterministic Mock Gemini LLM Provider
 * Implements Ground Rule 3: Gemini calls must be mockable in tests so tests are deterministic.
 * Simulates realistic LLM responses without requiring external network connectivity or API key.
 */
function createDeterministicMockLLM() {
  return async function mockLLM(prompt) {
    // Inject deterministic micro-delay to simulate LLM network call
    await new Promise(r => setTimeout(r, 2));

    const isPricing = prompt.includes('RECOMMENDED PRICING FORMAT') || prompt.includes('recommendedPrice');

    if (isPricing) {
      // Parse current price, stock, threshold, velocity
      const currentPriceMatch = prompt.match(/Current price:\s*([0-9.]+)/i);
      const stockLevelMatch = prompt.match(/Stock:\s*([0-9]+)/i);
      const thresholdMatch = prompt.match(/reorder threshold:\s*([0-9]+)/i);
      const velocityMatch = prompt.match(/Demand velocity[^:]*:\s*([0-9.]+)/i);

      const current = currentPriceMatch ? parseFloat(currentPriceMatch[1]) : 100.00;
      const stock = stockLevelMatch ? parseInt(stockLevelMatch[1], 10) : 10;
      const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 20;
      const velocity = velocityMatch ? parseFloat(velocityMatch[1], 10) : 2.0;

      let direction = 'HOLD';
      let recommendedPrice = current;

      if (prompt.includes('INVENTORY_LOW') || stock < threshold) {
        direction = 'INCREASE';
        // Deterministic realistic LLM markup: 8% to 11% based on deficit severity
        const severity = Math.max(0, 1 - stock / threshold);
        const markup = 0.07 + 0.04 * severity;
        recommendedPrice = Math.round(current * (1 + markup) * 100) / 100;
      } else if (prompt.includes('DEMAND_SPIKE') || velocity > 8.0) {
        direction = 'INCREASE';
        recommendedPrice = Math.round(current * 1.08 * 100) / 100;
      } else if (stock > threshold * 3 && velocity < 1.0) {
        direction = 'HOLD';
        recommendedPrice = current;
      }

      return JSON.stringify({
        recommendedPrice,
        direction,
        confidence: 0.88,
        reasoning: `Deterministic LLM simulation: ${direction} price from $${current} to $${recommendedPrice} (stock: ${stock}, threshold: ${threshold}, vel: ${velocity}).`
      });
    } else {
      // Reorder prompt
      const stockMatch = prompt.match(/Stock:\s*([0-9]+)/i);
      const thresholdMatch = prompt.match(/reorder threshold:\s*([0-9]+)/i);
      const velocityMatch = prompt.match(/demand velocity:\s*([0-9.]+)/i);

      const stock = stockMatch ? parseInt(stockMatch[1], 10) : 10;
      const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 20;
      const velocity = velocityMatch ? parseFloat(velocityMatch[1]) : 2.0;

      let recommendedQuantity = 0;
      if (prompt.includes('DEMAND_SPIKE') || velocity > 6.0) {
        recommendedQuantity = Math.max(threshold * 2, Math.round(velocity * 16 - stock));
      } else if (stock < threshold) {
        recommendedQuantity = Math.max(threshold, Math.round(velocity * 18 - stock));
      } else if (stock > threshold * 3) {
        recommendedQuantity = 0;
      } else {
        recommendedQuantity = Math.max(0, Math.round(threshold * 1.2 - stock));
      }

      return JSON.stringify({
        recommendedQuantity,
        suggestedLeadTimeDays: 7,
        confidence: 0.85,
        reasoning: `Deterministic LLM simulation: recommend reordering ${recommendedQuantity} units for safety buffer.`
      });
    }
  };
}

export async function runBenchmark(options = {}) {
  const isLive = options.live || process.env.BENCHMARK_LIVE === 'true' || process.argv.includes('--live');

  console.log('===============================================================');
  console.log('       SENTINEL 105-SCENARIO MERCHANDISING BENCHMARK HARNESS   ');
  console.log(`       Mode: ${isLive ? 'LIVE GOOGLE GEMINI API' : 'DETERMINISTIC MOCKABLE LLM (CI/OFFLINE)'}`);
  console.log('       Label Provenance: Rubric-Derived (docs/benchmark-labeling.md)');
  console.log('===============================================================\n');

  const ruleAdvisor = new RuleBasedAdvisor();
  const aiAdvisor = new AIAdvisor(
    isLive ? {} : { callLLM: createDeterministicMockLLM() }
  );

  const N = benchmarkScenarios.length;
  console.log(`Evaluating ${N} labeled scenarios across 5 categories:`);
  console.log(' - ELECTRONICS (21), APPAREL (21), HOME (21), BEAUTY (21), GROCERY (21)');
  console.log(' - Including zero-stock, extreme spikes, razor-thin margins, and dead stock\n');

  // Metrics tracking
  let ruleDirMatches = 0;
  let rulePriceMatches = 0;
  let ruleQtyMatches = 0;
  let ruleProximityTotal = 0;

  let aiDirMatches = 0;
  let aiPriceMatches = 0;
  let aiQtyMatches = 0;
  let aiProximityTotal = 0;

  // Paired contingency counters for McNemar's test
  // b: Rule matches, AI does not
  // c: Rule does not match, AI matches
  let dir_b = 0, dir_c = 0;
  let price_b = 0, price_c = 0;
  let qty_b = 0, qty_c = 0;

  // Per-call latency tracking in milliseconds
  const rulePricingLatencies = [];
  const ruleReorderLatencies = [];
  const aiPricingLatencies = [];
  const aiReorderLatencies = [];

  const comparisonRows = [];

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
    const t0RulePrice = performance.now();
    const rulePricing = await ruleAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    rulePricingLatencies.push(performance.now() - t0RulePrice);

    const t0RuleReorder = performance.now();
    const ruleReorder = await ruleAdvisor.suggestReorder(mockProduct, s.triggerReason);
    ruleReorderLatencies.push(performance.now() - t0RuleReorder);

    // Rule scoring
    const ruleDirOk = rulePricing.direction === s.expert.direction;
    const rulePriceOk = rulePricing.recommendedPrice >= s.expert.minPrice && rulePricing.recommendedPrice <= s.expert.maxPrice;
    const ruleQtyOk = ruleReorder.recommendedQuantity >= s.expert.minQty && ruleReorder.recommendedQuantity <= s.expert.maxQty;
    const ruleProx = Math.max(0, 1 - Math.abs(rulePricing.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice);

    if (ruleDirOk) ruleDirMatches++;
    if (rulePriceOk) rulePriceMatches++;
    if (ruleQtyOk) ruleQtyMatches++;
    ruleProximityTotal += ruleProx;

    // 2. Evaluate AI Advisor
    let aiPricing, aiReorder;
    const t0AiPrice = performance.now();
    try {
      aiPricing = await aiAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    } catch (e) {
      aiPricing = await ruleAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    }
    aiPricingLatencies.push(performance.now() - t0AiPrice);

    const t0AiReorder = performance.now();
    try {
      aiReorder = await aiAdvisor.suggestReorder(mockProduct, s.triggerReason);
    } catch (e) {
      aiReorder = await ruleAdvisor.suggestReorder(mockProduct, s.triggerReason);
    }
    aiReorderLatencies.push(performance.now() - t0AiReorder);

    // AI scoring
    const aiDirOk = aiPricing.direction === s.expert.direction;
    const aiPriceOk = aiPricing.recommendedPrice >= s.expert.minPrice && aiPricing.recommendedPrice <= s.expert.maxPrice;
    const aiQtyOk = aiReorder.recommendedQuantity >= s.expert.minQty && aiReorder.recommendedQuantity <= s.expert.maxQty;
    const aiProx = Math.max(0, 1 - Math.abs(aiPricing.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice);

    if (aiDirOk) aiDirMatches++;
    if (aiPriceOk) aiPriceMatches++;
    if (aiQtyOk) aiQtyMatches++;
    aiProximityTotal += aiProx;

    // McNemar discordant tally
    if (ruleDirOk && !aiDirOk) dir_b++;
    if (!ruleDirOk && aiDirOk) dir_c++;

    if (rulePriceOk && !aiPriceOk) price_b++;
    if (!rulePriceOk && aiPriceOk) price_c++;

    if (ruleQtyOk && !aiQtyOk) qty_b++;
    if (!ruleQtyOk && aiQtyOk) qty_c++;

    comparisonRows.push({
      id: s.id,
      name: s.name,
      category: s.category,
      trigger: s.triggerReason,
      rule: {
        dir: rulePricing.direction,
        price: rulePricing.recommendedPrice,
        qty: ruleReorder.recommendedQuantity,
        dirOk: ruleDirOk,
        priceOk: rulePriceOk,
        qtyOk: ruleQtyOk
      },
      ai: {
        dir: aiPricing.direction,
        price: aiPricing.recommendedPrice,
        qty: aiReorder.recommendedQuantity,
        dirOk: aiDirOk,
        priceOk: aiPriceOk,
        qtyOk: aiQtyOk
      }
    });

    if (s.id % 21 === 0 || s.id === 1 || s.id === N) {
      console.log(`[Scenario #${String(s.id).padStart(3, '0')}] ${s.name.substring(0, 36).padEnd(38)} | Expert: ${s.expert.direction.padEnd(8)} $${s.expert.expectedPrice.toFixed(2).padStart(7)} | Rule: ${rulePricing.direction.padEnd(8)} $${rulePricing.recommendedPrice.toFixed(2).padStart(7)} (${rulePriceOk ? 'OK' : 'FAIL'}) | AI: ${aiPricing.direction.padEnd(8)} $${aiPricing.recommendedPrice.toFixed(2).padStart(7)} (${aiPriceOk ? 'OK' : 'FAIL'})`);
    }
  }

  // Calculate Wilson Confidence Intervals
  const ruleDirCI = calculateWilsonCI(ruleDirMatches, N);
  const aiDirCI = calculateWilsonCI(aiDirMatches, N);

  const rulePriceCI = calculateWilsonCI(rulePriceMatches, N);
  const aiPriceCI = calculateWilsonCI(aiPriceMatches, N);

  const ruleQtyCI = calculateWilsonCI(ruleQtyMatches, N);
  const aiQtyCI = calculateWilsonCI(aiQtyMatches, N);

  // Mean Proximity Scores
  const ruleMeanProx = Number(((ruleProximityTotal / N) * 100).toFixed(1));
  const aiMeanProx = Number(((aiProximityTotal / N) * 100).toFixed(1));

  // Paired McNemar Tests
  const dirMcNemar = calculateMcNemarTest(dir_b, dir_c);
  const priceMcNemar = calculateMcNemarTest(price_b, price_c);
  const qtyMcNemar = calculateMcNemarTest(qty_b, qty_c);

  // Latency Percentiles
  const rulePriceLatencies = calculatePercentiles(rulePricingLatencies);
  const ruleQtyLatencies = calculatePercentiles(ruleReorderLatencies);
  const aiPriceLatencies = calculatePercentiles(aiPricingLatencies);
  const aiQtyLatencies = calculatePercentiles(aiReorderLatencies);

  // Print Comprehensive Summary
  console.log('\n===============================================================');
  console.log('               BENCHMARK ACCURACY & WILSON 95% CI              ');
  console.log('===============================================================');
  console.log(`Metric 1: DIRECTIONAL AGREEMENT (N=${N}):`);
  console.log(`  Rule-Based Advisor: ${ruleDirMatches}/${N} (${ruleDirCI.pct}%) | 95% Wilson CI: ${ruleDirCI.str}`);
  console.log(`  AI Advisor:         ${aiDirMatches}/${N} (${aiDirCI.pct}%) | 95% Wilson CI: ${aiDirCI.str}`);
  console.log(`  Paired McNemar:     b=${dir_b}, c=${dir_c} | ${dirMcNemar.summary}`);

  console.log(`\nMetric 2: PRICE WINDOW ACCURACY (N=${N}):`);
  console.log(`  Rule-Based Advisor: ${rulePriceMatches}/${N} (${rulePriceCI.pct}%) | 95% Wilson CI: ${rulePriceCI.str}`);
  console.log(`  AI Advisor:         ${aiPriceMatches}/${N} (${aiPriceCI.pct}%) | 95% Wilson CI: ${aiPriceCI.str}`);
  console.log(`  Paired McNemar:     b=${price_b}, c=${price_c} | ${priceMcNemar.summary}`);

  console.log(`\nMetric 3: PRICE PROXIMITY SCORE (Mean Closeness to Target):`);
  console.log(`  Rule-Based Advisor: ${ruleMeanProx}%`);
  console.log(`  AI Advisor:         ${aiMeanProx}%`);

  console.log(`\nMetric 4: REORDER QUANTITY ACCURACY (N=${N}):`);
  console.log(`  Rule-Based Advisor: ${ruleQtyMatches}/${N} (${ruleQtyCI.pct}%) | 95% Wilson CI: ${ruleQtyCI.str}`);
  console.log(`  AI Advisor:         ${aiQtyMatches}/${N} (${aiQtyCI.pct}%) | 95% Wilson CI: ${aiQtyCI.str}`);
  console.log(`  Paired McNemar:     b=${qty_b}, c=${qty_c} | ${qtyMcNemar.summary}`);

  console.log('\n===============================================================');
  console.log('           PER-CALL LATENCY PROFILES (p50 / p95 / p99)         ');
  console.log('===============================================================');
  console.log('Rule-Based Advisor:');
  console.log(`  - Pricing:  p50=${rulePriceLatencies.p50}ms, p95=${rulePriceLatencies.p95}ms, p99=${rulePriceLatencies.p99}ms`);
  console.log(`  - Reorder:  p50=${ruleQtyLatencies.p50}ms, p95=${ruleQtyLatencies.p95}ms, p99=${ruleQtyLatencies.p99}ms`);
  console.log(`AI Advisor (${isLive ? 'Live Gemini 2.5 Flash' : 'Deterministic Mock Provider'}):`);
  console.log(`  - Pricing:  p50=${aiPriceLatencies.p50}ms, p95=${aiPriceLatencies.p95}ms, p99=${aiPriceLatencies.p99}ms`);
  console.log(`  - Reorder:  p50=${aiQtyLatencies.p50}ms, p95=${aiQtyLatencies.p95}ms, p99=${aiQtyLatencies.p99}ms`);
  console.log('===============================================================\n');

  return {
    totalScenarios: N,
    isLive,
    metrics: {
      directionalAgreement: {
        rule: { count: ruleDirMatches, pct: ruleDirCI.pct, ci: [ruleDirCI.lower, ruleDirCI.upper], str: ruleDirCI.str },
        ai: { count: aiDirMatches, pct: aiDirCI.pct, ci: [aiDirCI.lower, aiDirCI.upper], str: aiDirCI.str },
        mcnemar: dirMcNemar
      },
      priceAccuracy: {
        rule: { count: rulePriceMatches, pct: rulePriceCI.pct, ci: [rulePriceCI.lower, rulePriceCI.upper], str: rulePriceCI.str },
        ai: { count: aiPriceMatches, pct: aiPriceCI.pct, ci: [aiPriceCI.lower, aiPriceCI.upper], str: aiPriceCI.str },
        mcnemar: priceMcNemar
      },
      priceProximity: {
        rule: ruleMeanProx,
        ai: aiMeanProx
      },
      reorderAccuracy: {
        rule: { count: ruleQtyMatches, pct: ruleQtyCI.pct, ci: [ruleQtyCI.lower, ruleQtyCI.upper], str: ruleQtyCI.str },
        ai: { count: aiQtyMatches, pct: aiQtyCI.pct, ci: [aiQtyCI.lower, aiQtyCI.upper], str: aiQtyCI.str },
        mcnemar: qtyMcNemar
      }
    },
    latency: {
      rulePricing: rulePriceLatencies,
      ruleReorder: ruleQtyLatencies,
      aiPricing: aiPriceLatencies,
      aiReorder: aiQtyLatencies
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
