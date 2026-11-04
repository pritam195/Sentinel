import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AIAdvisor from '../strategies/AIAdvisor.js';
import RuleBasedAdvisor from '../strategies/RuleBasedAdvisor.js';
import AdvisorLog from '../models/AdvisorLog.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import Config from '../models/Config.js';
import { processInventoryChange } from '../services/recommendationLoop.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

const sampleProduct = {
  _id: new mongoose.Types.ObjectId(),
  sku: 'TEST-SKU-001',
  name: 'Fault Test Ergonomic Keyboard',
  category: 'ELECTRONICS',
  currentPrice: 100.00,
  costPrice: 50.00,
  stockLevel: 5,
  reorderThreshold: 20,
  demandVelocity: 15
};

const ruleAdvisor = new RuleBasedAdvisor();

// Define 18 fault scenarios with explicit validation stages, outcomes, and reasons
export const faultScenarios = [
  {
    caseNumber: 1,
    name: 'Malformed JSON — Plain English text',
    stage: 'JSON Parsing',
    type: 'pricing',
    mockResponse: () => Promise.resolve('I think you should increase the price to $115 because stock is scarce.'),
    expectedOutcome: 'malformed_json',
    expectedReason: 'MALFORMED_JSON'
  },
  {
    caseNumber: 2,
    name: 'Malformed JSON — Truncated syntax',
    stage: 'JSON Parsing',
    type: 'pricing',
    mockResponse: () => Promise.resolve('{"recommendedPrice": 110.0, "direction": "INC'),
    expectedOutcome: 'malformed_json',
    expectedReason: 'MALFORMED_JSON'
  },
  {
    caseNumber: 3,
    name: 'Malformed JSON — Code block without valid JSON',
    stage: 'JSON Parsing',
    type: 'pricing',
    mockResponse: () => Promise.resolve('```python\nprint("raise price")\n```'),
    expectedOutcome: 'malformed_json',
    expectedReason: 'MALFORMED_JSON'
  },
  {
    caseNumber: 4,
    name: 'Missing Required Fields — Missing recommendedPrice',
    stage: 'Stage 1: Schema Validation',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ direction: 'INCREASE', confidence: 0.8, reasoning: 'Low stock' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 5,
    name: 'Missing Required Fields — Missing direction',
    stage: 'Stage 1: Schema Validation',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 110.0, confidence: 0.8, reasoning: 'Low stock' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 6,
    name: 'Missing Required Fields — Missing confidence',
    stage: 'Stage 1: Schema Validation',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 110.0, direction: 'INCREASE', reasoning: 'Low stock' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 7,
    name: 'Missing Required Fields — Missing reasoning',
    stage: 'Stage 1: Schema Validation',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 110.0, direction: 'INCREASE', confidence: 0.8 })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 8,
    name: 'Invalid Types — String for price and non-standard direction',
    stage: 'Stage 1: Schema Validation',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 'expensive', direction: 'SKYROCKET', confidence: 0.9, reasoning: 'Spike' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 9,
    name: 'Extreme Out-of-Bounds — Severe Underpricing (0.1x price = $10 on $100)',
    stage: 'Stage 2: Plausibility Check',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 10.0, direction: 'DECREASE', confidence: 0.95, reasoning: 'Dumping inventory' })),
    expectedOutcome: 'implausible_output',
    expectedReason: 'IMPLAUSIBLE_OUTPUT'
  },
  {
    caseNumber: 10,
    name: 'Extreme Out-of-Bounds — Severe Overpricing (5.0x price = $500 on $100)',
    stage: 'Stage 2: Plausibility Check',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 500.0, direction: 'INCREASE', confidence: 0.95, reasoning: 'Gouging demand surge' })),
    expectedOutcome: 'implausible_output',
    expectedReason: 'IMPLAUSIBLE_OUTPUT'
  },
  {
    caseNumber: 11,
    name: 'Extreme Out-of-Bounds — Negative Price (-$50)',
    stage: 'Stage 2: Plausibility Check',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: -50.0, direction: 'DECREASE', confidence: 0.8, reasoning: 'Negative price error' })),
    expectedOutcome: 'implausible_output',
    expectedReason: 'IMPLAUSIBLE_OUTPUT'
  },
  {
    caseNumber: 12,
    name: 'Out of Bounds — Confidence > 1.0 (confidence = 2.5)',
    stage: 'Stage 1: Schema Validation',
    type: 'pricing',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedPrice: 110.0, direction: 'INCREASE', confidence: 2.5, reasoning: 'Hyper confident' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 13,
    name: 'Reorder Fault — Missing recommendedQuantity',
    stage: 'Stage 1: Schema Validation',
    type: 'reorder',
    mockResponse: () => Promise.resolve(JSON.stringify({ suggestedLeadTimeDays: 7, confidence: 0.8, reasoning: 'Reorder needed' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 14,
    name: 'Reorder Fault — Astronomical Quantity (500,000 units on 20 threshold)',
    stage: 'Stage 2: Plausibility Check',
    type: 'reorder',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedQuantity: 500000, suggestedLeadTimeDays: 7, confidence: 0.9, reasoning: 'Bulk order' })),
    expectedOutcome: 'implausible_output',
    expectedReason: 'IMPLAUSIBLE_OUTPUT'
  },
  {
    caseNumber: 15,
    name: 'Reorder Fault — Non-integer float quantity (45.75 units)',
    stage: 'Stage 1: Schema Validation',
    type: 'reorder',
    mockResponse: () => Promise.resolve(JSON.stringify({ recommendedQuantity: 45.75, suggestedLeadTimeDays: 7, confidence: 0.8, reasoning: 'Fractional units' })),
    expectedOutcome: 'schema_invalid',
    expectedReason: 'SCHEMA_INVALID'
  },
  {
    caseNumber: 16,
    name: 'API Unreachable — HTTP 503 Service Unavailable',
    stage: 'Upstream Network',
    type: 'pricing',
    mockResponse: () => Promise.reject(new Error('LLM API error (503): Service Unavailable')),
    expectedOutcome: 'api_error',
    expectedReason: 'UPSTREAM_ERROR'
  },
  {
    caseNumber: 17,
    name: 'API Network Error — ECONNREFUSED',
    stage: 'Upstream Network',
    type: 'reorder',
    mockResponse: () => Promise.reject(new Error('connect ECONNREFUSED 142.250.190.42:443')),
    expectedOutcome: 'api_error',
    expectedReason: 'UPSTREAM_ERROR'
  },
  {
    caseNumber: 18,
    name: 'Network Timeout — AbortError after 10 seconds',
    stage: 'Upstream Timeout',
    type: 'pricing',
    mockResponse: () => {
      const err = new Error('LLM request timed out after 10 seconds.');
      err.name = 'AbortError';
      return Promise.reject(err);
    },
    expectedOutcome: 'timeout',
    expectedReason: 'TIMEOUT'
  }
];

export async function runFaultInjectionTests() {
  console.log('===============================================================');
  console.log('    SENTINEL FAULT-INJECTION & GUARDRAIL PIPELINE TEST SUITE   ');
  console.log('===============================================================');
  console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  let passed = 0;
  let failed = 0;
  const results = [];

  const baselineRulePricing = await ruleAdvisor.suggestPricing(sampleProduct, 5, 'INVENTORY_LOW');
  const baselineRuleReorder = await ruleAdvisor.suggestReorder(sampleProduct, 'INVENTORY_LOW');

  console.log('\n--- PART 1: 18-FAULT INJECTION BATTERY (FALLBACK VERIFICATION) ---');
  for (let i = 0; i < faultScenarios.length; i++) {
    const scenario = faultScenarios[i];
    const advisor = new AIAdvisor({ callLLM: scenario.mockResponse });

    let receivedResult = null;
    let caughtError = null;

    try {
      if (scenario.type === 'pricing') {
        receivedResult = await advisor.suggestPricing(sampleProduct, 5, 'INVENTORY_LOW');
      } else {
        receivedResult = await advisor.suggestReorder(sampleProduct, 'INVENTORY_LOW');
      }
    } catch (err) {
      caughtError = err;
    }

    // 1. Zero suggestions lost: advisor must never throw to caller
    const zeroSuggestionsLost = caughtError === null && receivedResult !== null;

    // 2. Fallback occurred
    let fallbackConfirmed = false;
    if (zeroSuggestionsLost) {
      if (scenario.type === 'pricing') {
        fallbackConfirmed = receivedResult.recommendedPrice === baselineRulePricing.recommendedPrice &&
          receivedResult.direction === baselineRulePricing.direction &&
          receivedResult.reasoning.includes('[Fallback') &&
          receivedResult.isFallback === true &&
          receivedResult.fallbackReason === scenario.expectedReason;
      } else {
        fallbackConfirmed = receivedResult.recommendedQuantity === baselineRuleReorder.recommendedQuantity &&
          receivedResult.reasoning.includes('[Fallback') &&
          receivedResult.isFallback === true &&
          receivedResult.fallbackReason === scenario.expectedReason;
      }
    }

    // 3. Check logged outcome in MongoDB AdvisorLog
    const latestLog = await AdvisorLog.findOne({
      logType: 'AI_CALL',
      sku: sampleProduct.sku,
      callType: scenario.type
    }).sort({ createdAt: -1 });

    const outcomeMatches = latestLog && 
      latestLog.outcome === scenario.expectedOutcome && 
      latestLog.fallbackReason === scenario.expectedReason &&
      latestLog.fellBack === true;

    const testPass = zeroSuggestionsLost && fallbackConfirmed && outcomeMatches;

    if (testPass) {
      passed++;
      console.log(`  [PASS] #${i + 1} [${scenario.stage}]: ${scenario.name}`);
      console.log(`         Outcome: ${latestLog.outcome} | Reason: ${latestLog.fallbackReason} | Fallback: YES`);
    } else {
      failed++;
      console.log(`  [FAIL] #${i + 1} [${scenario.stage}]: ${scenario.name}`);
      console.log(`         ZeroLost: ${zeroSuggestionsLost}, Fallback: ${fallbackConfirmed}, Logged: [outcome=${latestLog?.outcome}, reason=${latestLog?.fallbackReason}] (expected outcome=${scenario.expectedOutcome}, reason=${scenario.expectedReason})`);
    }

    results.push({
      caseNumber: i + 1,
      name: scenario.name,
      stage: scenario.stage,
      callType: scenario.type,
      expectedOutcome: scenario.expectedOutcome,
      actualOutcome: latestLog?.outcome || 'NONE',
      expectedReason: scenario.expectedReason,
      actualReason: latestLog?.fallbackReason || null,
      fallbackTriggered: fallbackConfirmed,
      passed: testPass
    });
  }

  console.log('\n--- PART 2: STAGE 3 POLICY CLAMPING LAYER TESTS ---');
  let policyPassed = 0;
  let policyTotal = 0;

  function assertPolicy(cond, msg) {
    policyTotal++;
    if (cond) {
      policyPassed++;
      console.log(`  [PASS] ${msg}`);
    } else {
      console.error(`  [FAIL] ${msg}`);
      throw new Error(`Policy assertion failed: ${msg}`);
    }
  }

  // Policy Test 1: A 40% increase clamped to 15% (suggestion IS STILL USED, raw value stored)
  const policyAdvisor15 = new AIAdvisor({
    callLLM: () => Promise.resolve('{"recommendedPrice": 140.0, "direction": "INCREASE", "confidence": 0.9, "reasoning": "High demand spike justify +40%"}'),
    maxSingleChangePercent: 15
  });

  const res15 = await policyAdvisor15.suggestPricing(sampleProduct, 5, 'DEMAND_SPIKE', { maxSingleChangePercent: 15 });
  assertPolicy(res15.isFallback === false, 'Policy clamp: Suggestion is STILL USED (isFallback is false)');
  assertPolicy(res15.outcome === 'clamped_by_policy', `Outcome is clamped_by_policy (got: ${res15.outcome})`);
  assertPolicy(res15.wasClamped === true, 'wasClamped is true');
  assertPolicy(res15.recommendedPrice === 115.00, `Price clamped from $140 (+40%) to $115 (+15%) (got: $${res15.recommendedPrice})`);
  assertPolicy(res15.rawPrice === 140.00, `Original raw value preserved: rawPrice = $140.00 (got: $${res15.rawPrice})`);
  assertPolicy(res15.reasoning.includes('clamped to max single change limit of +15%'), 'Reasoning notes policy clamp');

  const log15 = await AdvisorLog.findOne({
    logType: 'AI_CALL',
    sku: sampleProduct.sku,
    callType: 'pricing'
  }).sort({ createdAt: -1 });
  assertPolicy(log15 && log15.outcome === 'clamped_by_policy' && log15.fellBack === false, 'AdvisorLog records outcome = clamped_by_policy and fellBack = false');

  // Policy Test 2: Price below margin floor clamped to floor (raw value stored)
  // Product: currentPrice = 100, costPrice = 50, minMarginPercent = 20% -> margin floor = 50 * 1.2 = $60
  const productWithFloor = {
    ...sampleProduct,
    costPrice: 50.00,
    minMarginPercent: 20
  };
  const policyAdvisorFloor = new AIAdvisor({
    callLLM: () => Promise.resolve('{"recommendedPrice": 52.0, "direction": "DECREASE", "confidence": 0.85, "reasoning": "Clearance discount below floor"}'),
    maxSingleChangePercent: 50
  });

  const resFloor = await policyAdvisorFloor.suggestPricing(productWithFloor, 5, 'MANUAL', { maxSingleChangePercent: 50 });
  assertPolicy(resFloor.isFallback === false, 'Margin floor clamp: Suggestion is STILL USED (isFallback is false)');
  assertPolicy(resFloor.outcome === 'clamped_by_policy', `Outcome is clamped_by_policy (got: ${resFloor.outcome})`);
  assertPolicy(resFloor.wasClamped === true, 'wasClamped is true');
  assertPolicy(resFloor.recommendedPrice === 60.00, `Price clamped from $52.00 to margin floor $60.00 (got: $${resFloor.recommendedPrice})`);
  assertPolicy(resFloor.rawPrice === 52.00, `Original raw value preserved: rawPrice = $52.00 (got: $${resFloor.rawPrice})`);
  assertPolicy(resFloor.reasoning.includes('clamped to margin floor of $60.00'), 'Reasoning notes margin floor clamp');

  // Policy Test 3: 4th change in 24h rejected when limit is 3
  await Config.findOneAndUpdate({}, {
    activeStrategy: 'ai',
    maxChangesPer24h: 3,
    maxSingleChangePercent: 20
  }, { upsert: true });

  const quotaProduct = await Product.create({
    sku: 'POLICY-QUOTA-' + Date.now(),
    name: 'Quota Test Widget',
    category: 'ELECTRONICS',
    currentPrice: 100.00,
    costPrice: 50.00,
    stockLevel: 5,
    reorderThreshold: 20,
    demandVelocity: 2
  });

  // Seed 3 existing suggestions in last 24h
  for (let s = 1; s <= 3; s++) {
    await PricingSuggestion.create({
      productId: quotaProduct._id,
      currentPrice: 100,
      recommendedPrice: 100 + s,
      direction: 'INCREASE',
      confidence: 0.8,
      reasoning: `Prior change ${s}`,
      status: 'ACCEPTED',
      triggerReason: 'MANUAL',
      expiresAt: new Date(Date.now() + 86400000)
    });
  }

  // Attempt 4th change in 24h via processInventoryChange
  await processInventoryChange(quotaProduct);

  const pendingQuotaCount = await PricingSuggestion.countDocuments({
    productId: quotaProduct._id,
    triggerReason: 'INVENTORY_LOW'
  });
  assertPolicy(pendingQuotaCount === 0, '4th change in 24h rejected by policy quota: 0 suggestions created');

  const quotaRejectLog = await AdvisorLog.findOne({
    productId: quotaProduct._id,
    outcome: 'rejected_by_policy'
  });
  assertPolicy(quotaRejectLog !== null, 'AdvisorLog recorded outcome = rejected_by_policy');

  const total = faultScenarios.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log('\n---------------------------------------------------------------');
  console.log(`FAULT SUITE SUMMARY: ${passed}/${total} PASSED (${passRate}%)`);
  console.log(`POLICY SUITE SUMMARY: ${policyPassed}/${policyTotal} PASSED (100.0%)`);
  console.log(`TOTAL PIPELINE TESTS: ${passed + policyPassed}/${total + policyTotal} PASSED`);
  console.log('---------------------------------------------------------------\n');

  return {
    total,
    passed,
    failed,
    policyPassed,
    policyTotal,
    results
  };
}

if (process.argv[1] && process.argv[1].endsWith('faultInjection.test.js')) {
  runFaultInjectionTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test error:', err);
      process.exit(1);
    });
}
