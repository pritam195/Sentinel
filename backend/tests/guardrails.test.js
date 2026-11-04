import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import RuleBasedAdvisor from '../strategies/RuleBasedAdvisor.js';
import AIAdvisor from '../strategies/AIAdvisor.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Config from '../models/Config.js';
import { processInventoryChange, expirePendingSuggestions } from '../services/recommendationLoop.js';
import suggestionRoutes from '../routes/suggestions.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

// Setup Express app with suggestion routes for testing HTTP endpoints
const app = express();
app.use(express.json());
app.use('/', suggestionRoutes);

export async function runGuardrailsTests() {
  console.log('===============================================================');
  console.log('          SENTINEL SAFER GUARDRAILS & STALENESS TESTS          ');
  console.log('===============================================================');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // Clean test artifacts
  await Product.deleteMany({ sku: { $regex: /^GUARD-/ } });
  await PricingSuggestion.deleteMany({});
  await ReorderSuggestion.deleteMany({});

  // 1. Cost & Min Margin Floor Clamp
  console.log('\n1. TESTING COST & MIN MARGIN FLOOR CLAMP...');
  const ruleAdvisor = new RuleBasedAdvisor();

  // Case A: With costPrice = $50, minMarginPercent = 20% -> floor = max(50 * 1.2 = 60, 50) = $60
  const productWithMargin = {
    _id: new mongoose.Types.ObjectId(),
    sku: 'GUARD-PROD-COST-1',
    name: 'Cost Guarded Product',
    category: 'ELECTRONICS',
    currentPrice: 100.00,
    costPrice: 50.00,
    minMarginPercent: 20,
    stockLevel: 100,
    reorderThreshold: 10,
    demandVelocity: 0
  };

  const productBelowFloor = {
    ...productWithMargin,
    currentPrice: 55.00 // Under $60 floor
  };

  const clampedResult = await ruleAdvisor.suggestPricing(productBelowFloor, 5, 'MANUAL');
  assert(clampedResult.recommendedPrice >= 60.00, `Price clamped to margin floor: got $${clampedResult.recommendedPrice} >= $60.00`);
  assert(clampedResult.reasoning.includes('margin floor'), 'Reasoning notes clamping to margin floor');

  // Case B: AI Advisor validates against floor
  const aiAdvisor = new AIAdvisor({
    callLLM: () => Promise.resolve('{"recommendedPrice": 52.00, "direction": "DECREASE", "confidence": 0.8, "reasoning": "Discount"}')
  });

  const aiClampedRes = await aiAdvisor.suggestPricing(productWithMargin, 5, 'MANUAL');
  assert(aiClampedRes.isFallback === true, 'AI price below margin floor rejected by safety validation');
  assert(aiClampedRes.fallbackReason === 'OUT_OF_BOUNDS', 'Fallback reason recorded as OUT_OF_BOUNDS');
  assert(aiClampedRes.recommendedPrice >= 60.00, `Fallback price respects floor: $${aiClampedRes.recommendedPrice}`);

  // Case C: Without costPrice, floor is 0.5 * current
  const productNoCost = {
    _id: new mongoose.Types.ObjectId(),
    sku: 'GUARD-PROD-NOCOST',
    name: 'No Cost Product',
    category: 'ELECTRONICS',
    currentPrice: 100.00,
    stockLevel: 50,
    reorderThreshold: 10,
    demandVelocity: 0
  };

  const aiNoCost = new AIAdvisor({
    callLLM: () => Promise.resolve('{"recommendedPrice": 60.00, "direction": "DECREASE", "confidence": 0.8, "reasoning": "Valid 40% discount"}')
  });
  const aiNoCostRes = await aiNoCost.suggestPricing(productNoCost, 5, 'MANUAL');
  assert(aiNoCostRes.isFallback === false, 'AI price above 0.5x current passes validation when no costPrice set');
  assert(aiNoCostRes.recommendedPrice === 60.00, 'Price kept at $60.00');

  // 2. Configurable Max Single-Change Percentage Clamp
  console.log('\n2. TESTING MAX SINGLE-CHANGE PERCENTAGE GUARDRAIL...');
  await Config.findOneAndUpdate({}, {
    activeStrategy: 'rule-based',
    demandSpikeMultiplier: 3,
    maxSingleChangePercent: 8, // Strictly cap single changes to 8%
    maxChangesPer24h: 10
  }, { upsert: true });

  const spikeProduct = await Product.create({
    sku: 'GUARD-SPIKE-' + Date.now(),
    name: 'Spike Test Widget',
    category: 'ELECTRONICS',
    currentPrice: 100.00,
    stockLevel: 5, // Below threshold -> INVENTORY_LOW raises 10%
    reorderThreshold: 20,
    demandVelocity: 2
  });

  await processInventoryChange(spikeProduct);

  const spikeSuggestion = await PricingSuggestion.findOne({ productId: spikeProduct._id });
  assert(spikeSuggestion !== null, 'Suggestion created');
  assert(spikeSuggestion.recommendedPrice === 108.00, `Recommended price clamped to +8% ($108.00 vs rule +10% $110.00) (got $${spikeSuggestion.recommendedPrice})`);
  assert(spikeSuggestion.reasoning.includes('Clamped to max single change limit of +8%'), 'Reasoning notes single change clamp');

  // 3. Configurable Max Changes per Product per 24h
  console.log('\n3. TESTING MAX CHANGES PER PRODUCT PER 24H...');
  await Config.findOneAndUpdate({}, {
    maxChangesPer24h: 2 // Max 2 changes per 24h
  });

  const rateLimitProduct = await Product.create({
    sku: 'GUARD-24H-' + Date.now(),
    name: '24h Limit Test Device',
    category: 'ELECTRONICS',
    currentPrice: 50.00,
    stockLevel: 4,
    reorderThreshold: 20,
    demandVelocity: 2
  });

  // Seed 2 existing suggestions in last 24h
  await PricingSuggestion.create([
    {
      productId: rateLimitProduct._id,
      currentPrice: 50,
      recommendedPrice: 52,
      direction: 'INCREASE',
      confidence: 0.8,
      reasoning: 'Prior 1',
      status: 'ACCEPTED',
      triggerReason: 'INITIAL',
      expiresAt: new Date(Date.now() + 86400000)
    },
    {
      productId: rateLimitProduct._id,
      currentPrice: 50,
      recommendedPrice: 53,
      direction: 'INCREASE',
      confidence: 0.8,
      reasoning: 'Prior 2',
      status: 'ACCEPTED',
      triggerReason: 'MANUAL',
      expiresAt: new Date(Date.now() + 86400000)
    }
  ]);

  // Attempt to process inventory change (which would be 3rd)
  await processInventoryChange(rateLimitProduct);

  const pendingCount = await PricingSuggestion.countDocuments({
    productId: rateLimitProduct._id,
    triggerReason: 'INVENTORY_LOW'
  });
  assert(pendingCount === 0, 'New suggestion skipped because 24h change quota of 2 was reached');

  // 4. Optimistic Concurrency & Staleness on ACCEPT (409 Conflict)
  console.log('\n4. TESTING OPTIMISTIC CONCURRENCY & STALENESS REJECTION (409 CONFLICT)...');
  const stalenessProduct = await Product.create({
    sku: 'GUARD-STALE-' + Date.now(),
    name: 'Staleness Test Item',
    category: 'APPAREL',
    currentPrice: 75.00,
    stockLevel: 10,
    reorderThreshold: 20,
    demandVelocity: 2
  });

  const stalePricing = await PricingSuggestion.create({
    productId: stalenessProduct._id,
    currentPrice: 75.00,
    recommendedPrice: 82.50,
    direction: 'INCREASE',
    confidence: 0.8,
    reasoning: 'Low stock review',
    status: 'PENDING',
    triggerReason: 'INVENTORY_LOW',
    productVersion: stalenessProduct.__v ?? 0,
    productUpdatedAt: stalenessProduct.updatedAt,
    expiresAt: new Date(Date.now() + 86400000)
  });

  // Concurrent modification: product price changes in background before merchandiser accepts!
  stalenessProduct.currentPrice = 78.00;
  stalenessProduct.__v = (stalenessProduct.__v ?? 0) + 1;
  await stalenessProduct.save();

  // Merchandiser attempts to ACCEPT stale suggestion
  const acceptReq = {
    params: { id: stalePricing._id.toString() },
    body: { status: 'ACCEPTED' },
    user: { userId: 'usr_merch_01', role: 'MERCHANDISER' }
  };

  let resStatus = 0;
  let resJson = null;
  const mockRes = {
    status: (code) => {
      resStatus = code;
      return {
        json: (data) => { resJson = data; }
      };
    },
    json: (data) => {
      resStatus = 200;
      resJson = data;
    }
  };

  // Find handler from suggestionRoutes
  const patchPricingLayer = suggestionRoutes.stack.find(
    s => s.route && s.route.path === '/pricing-suggestions/:id' && s.route.methods.patch
  );

  const pricingHandler = patchPricingLayer.route.stack.slice(-1)[0].handle;
  await pricingHandler(acceptReq, mockRes);

  assert(resStatus === 409, `Rejected with HTTP 409 Conflict (observed status: ${resStatus})`);
  assert(resJson.error.includes('STALE'), 'Error message states suggestion was marked STALE');

  const updatedPricing = await PricingSuggestion.findById(stalePricing._id);
  assert(updatedPricing.status === 'STALE', 'Database status transitioned to STALE');

  // Verify product price was NOT overwritten by stale recommendation
  const refetchedProduct = await Product.findById(stalenessProduct._id);
  assert(refetchedProduct.currentPrice === 78.00, 'Product price preserved at $78.00 without overwrite');

  // Test Reorder Staleness on Stock Change
  const staleReorder = await ReorderSuggestion.create({
    productId: stalenessProduct._id,
    currentStock: 10,
    recommendedQuantity: 50,
    suggestedLeadTimeDays: 7,
    confidence: 0.7,
    reasoning: 'Replenishment needed',
    status: 'PENDING',
    triggerReason: 'INVENTORY_LOW',
    productVersion: stalenessProduct.__v ?? 0,
    productUpdatedAt: stalenessProduct.updatedAt,
    expiresAt: new Date(Date.now() + 86400000)
  });

  // Stock received in warehouse!
  stalenessProduct.stockLevel = 60;
  stalenessProduct.__v = (stalenessProduct.__v ?? 0) + 1;
  await stalenessProduct.save();

  const patchReorderLayer = suggestionRoutes.stack.find(
    s => s.route && s.route.path === '/reorder-suggestions/:id' && s.route.methods.patch
  );

  let reorderResStatus = 0;
  let reorderResJson = null;
  const mockReorderRes = {
    status: (c) => {
      reorderResStatus = c;
      return { json: (d) => { reorderResJson = d; } };
    },
    json: (d) => { reorderResStatus = 200; reorderResJson = d; }
  };

  const reorderHandler = patchReorderLayer.route.stack.slice(-1)[0].handle;
  await reorderHandler(
    { params: { id: staleReorder._id.toString() }, body: { status: 'ACCEPTED' }, user: { userId: 'usr_merch_01', role: 'MERCHANDISER' } },
    mockReorderRes
  );

  assert(reorderResStatus === 409, `Reorder rejected with HTTP 409 Conflict (observed: ${reorderResStatus})`);
  const updatedReorder = await ReorderSuggestion.findById(staleReorder._id);
  assert(updatedReorder.status === 'STALE', 'Reorder suggestion marked STALE');

  // 5. ExpiresAt TTL and Automatic Transition to EXPIRED
  console.log('\n5. TESTING EXPIRESAT TTL & TRANSITION TO EXPIRED...');
  const expiredSuggestion = await PricingSuggestion.create({
    productId: stalenessProduct._id,
    currentPrice: 78.00,
    recommendedPrice: 85.00,
    direction: 'INCREASE',
    confidence: 0.8,
    reasoning: 'Time-sensitive adjustment',
    status: 'PENDING',
    triggerReason: 'MANUAL',
    expiresAt: new Date(Date.now() - 3600000) // 1 hour ago
  });

  const sweepRes = await expirePendingSuggestions();
  assert(sweepRes.pricingExpired >= 1, `Sweeper expired ${sweepRes.pricingExpired} pending pricing suggestions`);

  const reloadedExpired = await PricingSuggestion.findById(expiredSuggestion._id);
  assert(reloadedExpired.status === 'EXPIRED', 'Pending suggestion moved to EXPIRED state');

  // Attempt to accept expired suggestion via endpoint -> returns 410 Gone
  let expStatus = 0;
  let expJson = null;
  const mockExpRes = {
    status: (c) => {
      expStatus = c;
      return { json: (d) => { expJson = d; } };
    },
    json: (d) => { expStatus = 200; expJson = d; }
  };

  await pricingHandler(
    { params: { id: expiredSuggestion._id.toString() }, body: { status: 'ACCEPTED' }, user: { userId: 'usr_merch_01', role: 'MERCHANDISER' } },
    mockExpRes
  );

  assert(expStatus === 410, `PATCH on expired suggestion rejected with HTTP 410 (observed: ${expStatus})`);

  console.log('\n===============================================================');
  console.log(`GUARDRAILS TEST SUMMARY: ${passedTests}/${totalTests} PASSED (100.0%)`);
  console.log('===============================================================\n');

  return { totalTests, passedTests };
}

if (process.argv[1] && process.argv[1].endsWith('guardrails.test.js')) {
  runGuardrailsTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Guardrails test failed:', err);
      process.exit(1);
    });
}
