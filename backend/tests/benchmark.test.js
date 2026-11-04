import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { performance } from 'perf_hooks';
import AIAdvisor from '../strategies/AIAdvisor.js';
import NaiveRuleAdvisor from '../strategies/NaiveRuleAdvisor.js';
import DaysOfSupplyRuleAdvisor from '../strategies/DaysOfSupplyRuleAdvisor.js';
import { benchmarkScenarios } from './data/benchmarkScenarios.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    return 'unknown';
  }
}

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
 */
export function calculateWilsonCI(x, n, z = 1.95996) {
  if (n === 0) return { lower: 0, upper: 0, pct: 0, str: '[0.0%, 0.0%]' };
  const p = x / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);
  return {
    lower: Number(lower.toFixed(4)),
    upper: Number(upper.toFixed(4)),
    pct: Number((p * 100).toFixed(1)),
    str: `[${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]`
  };
}

/**
 * McNemar's Paired Test with Edwards Continuity Correction
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
      summary: 'No discordant pairs (equivalent agreement)'
    };
  }

  const diff = Math.abs(b - c);
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
      ? `Distinguishable (chi2=${chi2.toFixed(2)}, p=${pValue.toFixed(4)} < 0.05)`
      : `Indistinguishable (chi2=${chi2.toFixed(2)}, p=${pValue.toFixed(4)} >= 0.05)`
  };
}

/**
 * Calculate p50, p95, p99 percentiles from array of numbers
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
 * Deterministic PRNG split (Mulberry32) by fixed seed
 * Partitions 105 scenarios into 32 dev (30.5%) and 73 held-out (69.5%)
 */
export function partitionScenarios(scenarios, seed = 42) {
  let s = seed;
  const rng = () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  const indices = scenarios.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const devCount = Math.round(scenarios.length * 0.30); // 32
  const devSet = new Set(indices.slice(0, devCount));

  return scenarios.map((scenario, index) => ({
    ...scenario,
    split: devSet.has(index) ? 'dev' : 'held-out'
  }));
}

/**
 * Deterministic Mock Gemini LLM Provider
 */
function createDeterministicMockLLM() {
  return async function mockLLM(prompt) {
    await new Promise(r => setTimeout(r, 2));

    const isPricing = prompt.includes('RECOMMENDED PRICING FORMAT') || prompt.includes('recommendedPrice');

    if (isPricing) {
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
      const stockMatch = prompt.match(/Stock:\s*([0-9]+)/i);
      const thresholdMatch = prompt.match(/reorder threshold:\s*([0-9]+)/i);
      const velocityMatch = prompt.match(/demand velocity:\s*([0-9.]+)/i);

      const stock = stockMatch ? parseInt(stockMatch[1], 10) : 10;
      const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 20;
      const velocity = velocityMatch ? parseFloat(velocityMatch[1], 10) : 2.0;

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
  const mode = process.env.BENCHMARK_MODE || (process.env.BENCHMARK_LIVE === 'true' || process.argv.includes('--live') ? 'live' : 'mock');
  const isLive = mode === 'live';
  const modelName = isLive ? (process.env.LLM_MODEL || 'gemini-2.5-flash') : 'gemini-2.5-flash (deterministic mock)';
  const gitCommit = getGitCommit();
  const timestamp = new Date().toISOString();

  console.log('===============================================================');
  console.log('       SENTINEL 105-SCENARIO MERCHANDISING BENCHMARK HARNESS   ');
  console.log(`       Mode: ${mode.toUpperCase()} | Model: ${modelName}`);
  console.log(`       Git Commit: ${gitCommit} | Timestamp: ${timestamp}`);
  console.log('       Label Provenance: Rubric-Derived (docs/benchmark-labeling.md)');
  console.log('===============================================================\n');

  // Instantiate the three advisors
  const naiveAdvisor = new NaiveRuleAdvisor();
  const daysOfSupplyAdvisor = new DaysOfSupplyRuleAdvisor({
    leadTimeDays: 7,
    reviewPeriodDays: 7,
    safetyStockDays: 3
  });
  const aiAdvisor = new AIAdvisor(
    isLive ? {} : { callLLM: createDeterministicMockLLM() }
  );

  const partitioned = partitionScenarios(benchmarkScenarios, 42);
  const N = partitioned.length;
  const devScenarios = partitioned.filter(s => s.split === 'dev');
  const heldOutScenarios = partitioned.filter(s => s.split === 'held-out');

  console.log(`Partitioned ${N} scenarios: ${devScenarios.length} dev (30.5%), ${heldOutScenarios.length} held-out (69.5%)`);
  console.log('Evaluating 3 Advisors: [NaiveRule, DaysOfSupplyRule, AIAdvisor]\n');

  // Rate limiter throttle for live API calls (15 calls/min = 4000ms delay)
  const throttleMs = isLive ? (options.throttleMs || 4000) : 0;

  // Tracker for evaluation results
  const evaluations = [];

  let aiPricingAnswered = 0;
  let aiPricingFellBack = 0;
  let aiReorderAnswered = 0;
  let aiReorderFellBack = 0;

  const latencies = {
    naivePricing: [],
    naiveReorder: [],
    dosPricing: [],
    dosReorder: [],
    aiPricing: [],
    aiReorder: []
  };

  for (let i = 0; i < N; i++) {
    const s = partitioned[i];
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

    // 1. Evaluate NaiveRule
    const t0NaiveP = performance.now();
    const naiveP = await naiveAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    latencies.naivePricing.push(performance.now() - t0NaiveP);

    const t0NaiveR = performance.now();
    const naiveR = await naiveAdvisor.suggestReorder(mockProduct, s.triggerReason);
    latencies.naiveReorder.push(performance.now() - t0NaiveR);

    // 2. Evaluate DaysOfSupplyRule
    const t0DosP = performance.now();
    const dosP = await daysOfSupplyAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    latencies.dosPricing.push(performance.now() - t0DosP);

    const t0DosR = performance.now();
    const dosR = await daysOfSupplyAdvisor.suggestReorder(mockProduct, s.triggerReason);
    latencies.dosReorder.push(performance.now() - t0DosR);

    // 3. Evaluate AIAdvisor (throttle in live mode)
    if (throttleMs > 0 && i > 0) {
      await new Promise(r => setTimeout(r, throttleMs));
    }

    let aiP = null;
    let aiPFellBack = false;
    const t0AiP = performance.now();
    try {
      aiP = await aiAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
      if (aiP.isFallback) aiPFellBack = true;
    } catch (e) {
      aiPFellBack = true;
      aiP = await naiveAdvisor.suggestPricing(mockProduct, s.categoryAverageVelocity, s.triggerReason);
    }
    latencies.aiPricing.push(performance.now() - t0AiP);

    if (aiPFellBack) {
      aiPricingFellBack++;
    } else {
      aiPricingAnswered++;
    }

    if (throttleMs > 0) {
      await new Promise(r => setTimeout(r, throttleMs));
    }

    let aiR = null;
    let aiRFellBack = false;
    const t0AiR = performance.now();
    try {
      aiR = await aiAdvisor.suggestReorder(mockProduct, s.triggerReason);
      if (aiR.isFallback) aiRFellBack = true;
    } catch (e) {
      aiRFellBack = true;
      aiR = await naiveAdvisor.suggestReorder(mockProduct, s.triggerReason);
    }
    latencies.aiReorder.push(performance.now() - t0AiR);

    if (aiRFellBack) {
      aiReorderFellBack++;
    } else {
      aiReorderAnswered++;
    }

    // Score Naive
    const naiveDirOk = naiveP.direction === s.expert.direction;
    const naivePriceOk = naiveP.recommendedPrice >= s.expert.minPrice && naiveP.recommendedPrice <= s.expert.maxPrice;
    const naiveQtyOk = naiveR.recommendedQuantity >= s.expert.minQty && naiveR.recommendedQuantity <= s.expert.maxQty;
    const naiveProx = Math.max(0, 1 - Math.abs(naiveP.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice);

    // Score DaysOfSupply
    const dosDirOk = dosP.direction === s.expert.direction;
    const dosPriceOk = dosP.recommendedPrice >= s.expert.minPrice && dosP.recommendedPrice <= s.expert.maxPrice;
    const dosQtyOk = dosR.recommendedQuantity >= s.expert.minQty && dosR.recommendedQuantity <= s.expert.maxQty;
    const dosProx = Math.max(0, 1 - Math.abs(dosP.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice);

    // Score AI (only recorded if answered)
    const aiDirOk = !aiPFellBack && (aiP.direction === s.expert.direction);
    const aiPriceOk = !aiPFellBack && (aiP.recommendedPrice >= s.expert.minPrice && aiP.recommendedPrice <= s.expert.maxPrice);
    const aiQtyOk = !aiRFellBack && (aiR.recommendedQuantity >= s.expert.minQty && aiR.recommendedQuantity <= s.expert.maxQty);
    const aiProx = !aiPFellBack ? Math.max(0, 1 - Math.abs(aiP.recommendedPrice - s.expert.expectedPrice) / s.expert.expectedPrice) : null;

    evaluations.push({
      id: s.id,
      name: s.name,
      category: s.category,
      split: s.split,
      expert: s.expert,
      naive: { dir: naiveP.direction, price: naiveP.recommendedPrice, qty: naiveR.recommendedQuantity, dirOk: naiveDirOk, priceOk: naivePriceOk, qtyOk: naiveQtyOk, prox: naiveProx },
      dos: { dir: dosP.direction, price: dosP.recommendedPrice, qty: dosR.recommendedQuantity, dirOk: dosDirOk, priceOk: dosPriceOk, qtyOk: dosQtyOk, prox: dosProx },
      ai: { dir: aiP.direction, price: aiP.recommendedPrice, qty: aiR.recommendedQuantity, fellBack: aiPFellBack || aiRFellBack, pFellBack: aiPFellBack, rFellBack: aiRFellBack, dirOk: aiDirOk, priceOk: aiPriceOk, qtyOk: aiQtyOk, prox: aiProx }
    });

    if (s.id % 21 === 0 || s.id === 1 || s.id === N) {
      console.log(`[Scenario #${String(s.id).padStart(3, '0')}] [${s.split.toUpperCase()}] ${s.name.substring(0, 28).padEnd(30)} | Exp Price: $${s.expert.expectedPrice.toFixed(2).padStart(7)} | Naive: $${naiveP.recommendedPrice.toFixed(2).padStart(7)} (${naivePriceOk ? 'OK' : 'FAIL'}) | DoS Qty: ${dosR.recommendedQuantity} (${dosQtyOk ? 'OK' : 'FAIL'}) | AI Qty: ${aiR.recommendedQuantity} (${aiQtyOk ? 'OK' : 'FAIL'})`);
    }
  }

  // Helper to score a set of evaluations
  function scoreSubset(rows) {
    const total = rows.length;
    let naiveDir = 0, naivePrice = 0, naiveQty = 0, naiveProxSum = 0;
    let dosDir = 0, dosPrice = 0, dosQty = 0, dosProxSum = 0;

    let aiPAnswered = 0, aiDir = 0, aiPrice = 0, aiProxSum = 0;
    let aiRAnswered = 0, aiQty = 0;

    // Discordant counters for McNemar:
    // Pair A: Naive vs DoS
    let n_dos_dir_b = 0, n_dos_dir_c = 0;
    let n_dos_price_b = 0, n_dos_price_c = 0;
    let n_dos_qty_b = 0, n_dos_qty_c = 0;

    // Pair B: Naive vs AI
    let n_ai_dir_b = 0, n_ai_dir_c = 0;
    let n_ai_price_b = 0, n_ai_price_c = 0;
    let n_ai_qty_b = 0, n_ai_qty_c = 0;

    // Pair C: DoS vs AI
    let dos_ai_dir_b = 0, dos_ai_dir_c = 0;
    let dos_ai_price_b = 0, dos_ai_price_c = 0;
    let dos_ai_qty_b = 0, dos_ai_qty_c = 0;

    for (const r of rows) {
      if (r.naive.dirOk) naiveDir++;
      if (r.naive.priceOk) naivePrice++;
      if (r.naive.qtyOk) naiveQty++;
      naiveProxSum += r.naive.prox;

      if (r.dos.dirOk) dosDir++;
      if (r.dos.priceOk) dosPrice++;
      if (r.dos.qtyOk) dosQty++;
      dosProxSum += r.dos.prox;

      // Naive vs DoS
      if (r.naive.dirOk && !r.dos.dirOk) n_dos_dir_b++;
      if (!r.naive.dirOk && r.dos.dirOk) n_dos_dir_c++;
      if (r.naive.priceOk && !r.dos.priceOk) n_dos_price_b++;
      if (!r.naive.priceOk && r.dos.priceOk) n_dos_price_c++;
      if (r.naive.qtyOk && !r.dos.qtyOk) n_dos_qty_b++;
      if (!r.naive.qtyOk && r.dos.qtyOk) n_dos_qty_c++;

      // AI Pricing
      if (!r.ai.pFellBack) {
        aiPAnswered++;
        if (r.ai.dirOk) aiDir++;
        if (r.ai.priceOk) aiPrice++;
        aiProxSum += r.ai.prox;

        // Discordant vs Naive
        if (r.naive.dirOk && !r.ai.dirOk) n_ai_dir_b++;
        if (!r.naive.dirOk && r.ai.dirOk) n_ai_dir_c++;
        if (r.naive.priceOk && !r.ai.priceOk) n_ai_price_b++;
        if (!r.naive.priceOk && r.ai.priceOk) n_ai_price_c++;

        // Discordant vs DoS
        if (r.dos.dirOk && !r.ai.dirOk) dos_ai_dir_b++;
        if (!r.dos.dirOk && r.ai.dirOk) dos_ai_dir_c++;
        if (r.dos.priceOk && !r.ai.priceOk) dos_ai_price_b++;
        if (!r.dos.priceOk && r.ai.priceOk) dos_ai_price_c++;
      }

      // AI Reorder
      if (!r.ai.rFellBack) {
        aiRAnswered++;
        if (r.ai.qtyOk) aiQty++;

        if (r.naive.qtyOk && !r.ai.qtyOk) n_ai_qty_b++;
        if (!r.naive.qtyOk && r.ai.qtyOk) n_ai_qty_c++;

        if (r.dos.qtyOk && !r.ai.qtyOk) dos_ai_qty_b++;
        if (!r.dos.qtyOk && r.ai.qtyOk) dos_ai_qty_c++;
      }
    }

    return {
      total,
      naive: {
        dir: calculateWilsonCI(naiveDir, total),
        price: calculateWilsonCI(naivePrice, total),
        qty: calculateWilsonCI(naiveQty, total),
        prox: Number(((naiveProxSum / total) * 100).toFixed(1)),
        counts: { dir: naiveDir, price: naivePrice, qty: naiveQty }
      },
      dos: {
        dir: calculateWilsonCI(dosDir, total),
        price: calculateWilsonCI(dosPrice, total),
        qty: calculateWilsonCI(dosQty, total),
        prox: Number(((dosProxSum / total) * 100).toFixed(1)),
        counts: { dir: dosDir, price: dosPrice, qty: dosQty }
      },
      ai: {
        pAnswered: aiPAnswered,
        rAnswered: aiRAnswered,
        dir: calculateWilsonCI(aiDir, aiPAnswered),
        price: calculateWilsonCI(aiPrice, aiPAnswered),
        qty: calculateWilsonCI(aiQty, aiRAnswered),
        prox: aiPAnswered > 0 ? Number(((aiProxSum / aiPAnswered) * 100).toFixed(1)) : 0,
        counts: { dir: aiDir, price: aiPrice, qty: aiQty }
      },
      mcnemar: {
        naive_vs_dos: {
          dir: calculateMcNemarTest(n_dos_dir_b, n_dos_dir_c),
          price: calculateMcNemarTest(n_dos_price_b, n_dos_price_c),
          qty: calculateMcNemarTest(n_dos_qty_b, n_dos_qty_c)
        },
        naive_vs_ai: {
          dir: calculateMcNemarTest(n_ai_dir_b, n_ai_dir_c),
          price: calculateMcNemarTest(n_ai_price_b, n_ai_price_c),
          qty: calculateMcNemarTest(n_ai_qty_b, n_ai_qty_c)
        },
        dos_vs_ai: {
          dir: calculateMcNemarTest(dos_ai_dir_b, dos_ai_dir_c),
          price: calculateMcNemarTest(dos_ai_price_b, dos_ai_price_c),
          qty: calculateMcNemarTest(dos_ai_qty_b, dos_ai_qty_c)
        }
      }
    };
  }

  const fullScore = scoreSubset(evaluations);
  const devScore = scoreSubset(evaluations.filter(e => e.split === 'dev'));
  const heldOutScore = scoreSubset(evaluations.filter(e => e.split === 'held-out'));

  // Calculate Latency Percentiles
  const latencySummary = {
    naivePricing: calculatePercentiles(latencies.naivePricing),
    naiveReorder: calculatePercentiles(latencies.naiveReorder),
    dosPricing: calculatePercentiles(latencies.dosPricing),
    dosReorder: calculatePercentiles(latencies.dosReorder),
    aiPricing: calculatePercentiles(latencies.aiPricing),
    aiReorder: calculatePercentiles(latencies.aiReorder)
  };

  const resultsJSON = {
    metadata: {
      mode,
      model: modelName,
      gitCommit,
      timestamp,
      totalScenarios: N,
      devCount: devScenarios.length,
      heldOutCount: heldOutScenarios.length,
      aiPricingCalls: { total: N, answered: aiPricingAnswered, fellBack: aiPricingFellBack },
      aiReorderCalls: { total: N, answered: aiReorderAnswered, fellBack: aiReorderFellBack }
    },
    full: fullScore,
    dev: devScore,
    heldOut: heldOutScore,
    latency: latencySummary
  };

  // Write JSON results file
  const resultsDir = path.resolve(__dirname, '../logs');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  const jsonPath = path.join(resultsDir, 'benchmark-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(resultsJSON, null, 2));
  console.log(`Saved benchmark results JSON to: ${jsonPath}`);

  // Display Console Output
  console.log('\n===============================================================');
  console.log(`      BENCHMARK RESULTS: HELD-OUT SPLIT (N=${heldOutScenarios.length})`);
  console.log('===============================================================');
  console.log(`1. Directional Agreement:`);
  console.log(`   - NaiveRule:    ${heldOutScore.naive.counts.dir}/${heldOutScore.total} (${heldOutScore.naive.dir.pct}%) ${heldOutScore.naive.dir.str}`);
  console.log(`   - DaysOfSupply: ${heldOutScore.dos.counts.dir}/${heldOutScore.total} (${heldOutScore.dos.dir.pct}%) ${heldOutScore.dos.dir.str}`);
  console.log(`   - AIAdvisor:    ${heldOutScore.ai.counts.dir}/${heldOutScore.ai.pAnswered} (${heldOutScore.ai.dir.pct}%) ${heldOutScore.ai.dir.str}`);
  console.log(`   - DoS vs AI McNemar: ${heldOutScore.mcnemar.dos_vs_ai.dir.summary}`);

  console.log(`\n2. Price Window Accuracy:`);
  console.log(`   - NaiveRule:    ${heldOutScore.naive.counts.price}/${heldOutScore.total} (${heldOutScore.naive.price.pct}%) ${heldOutScore.naive.price.str}`);
  console.log(`   - DaysOfSupply: ${heldOutScore.dos.counts.price}/${heldOutScore.total} (${heldOutScore.dos.price.pct}%) ${heldOutScore.dos.price.str}`);
  console.log(`   - AIAdvisor:    ${heldOutScore.ai.counts.price}/${heldOutScore.ai.pAnswered} (${heldOutScore.ai.price.pct}%) ${heldOutScore.ai.price.str}`);
  console.log(`   - DoS vs AI McNemar: ${heldOutScore.mcnemar.dos_vs_ai.price.summary}`);

  console.log(`\n3. Price Proximity Score:`);
  console.log(`   - NaiveRule:    ${heldOutScore.naive.prox}%`);
  console.log(`   - DaysOfSupply: ${heldOutScore.dos.prox}%`);
  console.log(`   - AIAdvisor:    ${heldOutScore.ai.prox}%`);

  console.log(`\n4. Reorder Quantity Accuracy:`);
  console.log(`   - NaiveRule:    ${heldOutScore.naive.counts.qty}/${heldOutScore.total} (${heldOutScore.naive.qty.pct}%) ${heldOutScore.naive.qty.str}`);
  console.log(`   - DaysOfSupply: ${heldOutScore.dos.counts.qty}/${heldOutScore.total} (${heldOutScore.dos.qty.pct}%) ${heldOutScore.dos.qty.str}`);
  console.log(`   - AIAdvisor:    ${heldOutScore.ai.counts.qty}/${heldOutScore.ai.rAnswered} (${heldOutScore.ai.qty.pct}%) ${heldOutScore.ai.qty.str}`);
  console.log(`   - Naive vs DoS McNemar: ${heldOutScore.mcnemar.naive_vs_dos.qty.summary}`);
  console.log(`   - DoS vs AI McNemar:    ${heldOutScore.mcnemar.dos_vs_ai.qty.summary}`);
  console.log('===============================================================\n');

  return resultsJSON;
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
