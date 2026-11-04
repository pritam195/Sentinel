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
import productRoutes from '../routes/products.js';
import { signToken } from '../middleware/auth.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

// Setup Express app with suggestion routes and product routes for testing HTTP endpoints
const app = express();
app.use(express.json());
app.use('/products', productRoutes);
app.use('/', suggestionRoutes);

export async function runGuardrailsTests() {
  console.log('===============================================================');
  console.log('          SENTINEL SAFER GUARDRAILS & STALENESS TESTS          ');
  console.log('===============================================================');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const merchandiserToken = signToken({ userId: 'usr_merch_01', role: 'MERCHANDISER' });
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${merchandiserToken}`
  };

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

  // Case B: AI Advisor applies Stage 3 margin floor policy clamp (suggestion is used, raw value preserved)
  const aiAdvisor = new AIAdvisor({
    callLLM: () => Promise.resolve('{"recommendedPrice": 52.00, "direction": "DECREASE", "confidence": 0.8, "reasoning": "Discount"}'),
    maxSingleChangePercent: 50
  });

  const aiClampedRes = await aiAdvisor.suggestPricing(productWithMargin, 5, 'MANUAL', { maxSingleChangePercent: 50 });
  assert(aiClampedRes.isFallback === false, 'AI price below margin floor is clamped by policy (isFallback is false)');
  assert(aiClampedRes.outcome === 'clamped_by_policy', 'Outcome is clamped_by_policy');
  assert(aiClampedRes.wasClamped === true, 'wasClamped is true');
  assert(aiClampedRes.recommendedPrice === 60.00, `Clamped price respects margin floor: $${aiClampedRes.recommendedPrice}`);
  assert(aiClampedRes.rawPrice === 52.00, `Raw price preserved: $${aiClampedRes.rawPrice}`);
  assert(aiClampedRes.reasoning.includes('margin floor'), 'Reasoning notes clamping to margin floor');

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
    callLLM: () => Promise.resolve('{"recommendedPrice": 60.00, "direction": "DECREASE", "confidence": 0.8, "reasoning": "Valid 40% discount"}'),
    maxSingleChangePercent: 50
  });
  const aiNoCostRes = await aiNoCost.suggestPricing(productNoCost, 5, 'MANUAL', { maxSingleChangePercent: 50 });
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

  // 4. Optimistic Concurrency & Staleness on ACCEPT (409 Conflict) via Real Routes
  console.log('\n4. TESTING OPTIMISTIC CONCURRENCY & STALENESS REJECTION (409 CONFLICT) VIA REAL HTTP ROUTES...');
  
  // 4.1 Price change stales pricing suggestion (via real PATCH /products/:id/price)
  const stalenessProduct = await Product.create({
    sku: 'GUARD-STALE-' + Date.now(),
    name: 'Staleness Test Item',
    category: 'APPAREL',
    currentPrice: 75.00,
    costPrice: 40.00,
    stockLevel: 10,
    reorderThreshold: 20,
    demandVelocity: 2,
    priceVersion: 1
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
    priceVersion: stalenessProduct.priceVersion,
    expiresAt: new Date(Date.now() + 86400000)
  });

  // Concurrent modification: product price updated via real PATCH /products/:id/price route
  const patchPriceRes = await fetch(`${baseUrl}/products/${stalenessProduct._id}/price`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPrice: 78.00 })
  });
  assert(patchPriceRes.status === 200, 'Real PATCH /products/:id/price returns 200 OK');

  // Attempt to accept suggestion via real PATCH /pricing-suggestions/:id
  const acceptRes1 = await fetch(`${baseUrl}/pricing-suggestions/${stalePricing._id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ACCEPTED' })
  });
  const acceptRes1Json = await acceptRes1.json();

  assert(acceptRes1.status === 409, `Price change: Rejected with HTTP 409 Conflict (observed status: ${acceptRes1.status})`);
  assert(acceptRes1Json.error && acceptRes1Json.error.includes('STALE'), 'Error message states suggestion was marked STALE');
  const updatedPricing = await PricingSuggestion.findById(stalePricing._id);
  assert(updatedPricing.status === 'STALE', 'Database status transitioned to STALE');
  const refetchedProduct = await Product.findById(stalenessProduct._id);
  assert(refetchedProduct.currentPrice === 78.00, 'Product price preserved at $78.00 without overwrite');
  assert(refetchedProduct.priceVersion === 2, 'Product priceVersion incremented to 2');

  // 4.2 Normal purchase via real POST /products/:id/orders does NOT stale pricing suggestion
  const purchaseProduct = await Product.create({
    sku: 'GUARD-PURCHASE-' + Date.now(),
    name: 'Purchase Staleness Item',
    category: 'APPAREL',
    currentPrice: 50.00,
    stockLevel: 50,
    reorderThreshold: 20,
    demandVelocity: 2,
    priceVersion: 1
  });

  const validPricing = await PricingSuggestion.create({
    productId: purchaseProduct._id,
    currentPrice: 50.00,
    recommendedPrice: 55.00,
    direction: 'INCREASE',
    confidence: 0.85,
    reasoning: 'Demand surge pricing',
    status: 'PENDING',
    triggerReason: 'DEMAND_SPIKE',
    priceVersion: purchaseProduct.priceVersion,
    expiresAt: new Date(Date.now() + 86400000)
  });

  // Normal purchase order modifies stockLevel via real POST /products/:id/orders
  const orderRes = await fetch(`${baseUrl}/products/${purchaseProduct._id}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qty: 5 })
  });
  assert(orderRes.status === 200, 'Real POST /products/:id/orders returns 200 OK');

  const purchasedDoc = await Product.findById(purchaseProduct._id);
  assert(purchasedDoc.stockLevel === 45, 'Stock decreased to 45');
  assert(purchasedDoc.priceVersion === 1, 'priceVersion unchanged at 1 after normal purchase order');

  const acceptRes2 = await fetch(`${baseUrl}/pricing-suggestions/${validPricing._id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ACCEPTED' })
  });
  assert(acceptRes2.status === 200, `Normal purchase: Pricing suggestion ACCEPTED with 200 OK (got ${acceptRes2.status})`);
  const acceptedPricing = await PricingSuggestion.findById(validPricing._id);
  assert(acceptedPricing.status === 'ACCEPTED', 'Pricing suggestion transitioned to ACCEPTED despite stock change');
  const refetchedPurchased = await Product.findById(purchaseProduct._id);
  assert(refetchedPurchased.currentPrice === 55.00, 'Product currentPrice updated to recommendedPrice $55.00');

  // 4.3 Large stock change via real PATCH /products/:id/stock stales a reorder suggestion (drift > 25%)
  const reorderProduct = await Product.create({
    sku: 'GUARD-REORDER-STALE-' + Date.now(),
    name: 'Reorder Drift Item',
    category: 'APPAREL',
    currentPrice: 30.00,
    stockLevel: 20,
    reorderThreshold: 20,
    demandVelocity: 2
  });

  const largeDriftReorder = await ReorderSuggestion.create({
    productId: reorderProduct._id,
    currentStock: 20,
    stockAtGeneration: 20,
    recommendedQuantity: 40,
    suggestedLeadTimeDays: 7,
    confidence: 0.8,
    reasoning: 'Replenish stock',
    status: 'PENDING',
    triggerReason: 'INVENTORY_LOW',
    expiresAt: new Date(Date.now() + 86400000)
  });

  // Large stock change via real PATCH /products/:id/stock: stock drops from 20 to 10 (50% drift > 25% threshold)
  const stockRes = await fetch(`${baseUrl}/products/${reorderProduct._id}/stock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stockLevel: 10 })
  });
  assert(stockRes.status === 200, 'Real PATCH /products/:id/stock returns 200 OK');

  const acceptRes3 = await fetch(`${baseUrl}/reorder-suggestions/${largeDriftReorder._id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ACCEPTED' })
  });
  const acceptRes3Json = await acceptRes3.json();

  assert(acceptRes3.status === 409, `Large stock change: Reorder rejected with HTTP 409 Conflict (observed: ${acceptRes3.status})`);
  assert(acceptRes3Json.error && acceptRes3Json.error.includes('drifted'), 'Error message notes stock state drifted beyond threshold');
  const updatedLargeDrift = await ReorderSuggestion.findById(largeDriftReorder._id);
  assert(updatedLargeDrift.status === 'STALE', 'Reorder suggestion marked STALE due to large drift');

  // 4.4 Small stock change via real POST /products/:id/orders does NOT stale a reorder suggestion (drift <= 25%)
  const smallDriftProduct = await Product.create({
    sku: 'GUARD-REORDER-VALID-' + Date.now(),
    name: 'Reorder Minor Drift Item',
    category: 'APPAREL',
    currentPrice: 30.00,
    stockLevel: 20,
    reorderThreshold: 20,
    demandVelocity: 2
  });

  const smallDriftReorder = await ReorderSuggestion.create({
    productId: smallDriftProduct._id,
    currentStock: 20,
    stockAtGeneration: 20,
    recommendedQuantity: 40,
    suggestedLeadTimeDays: 7,
    confidence: 0.8,
    reasoning: 'Replenish stock',
    status: 'PENDING',
    triggerReason: 'INVENTORY_LOW',
    expiresAt: new Date(Date.now() + 86400000)
  });

  // Small stock change via real POST /products/:id/orders: stock drops from 20 to 18 (10% drift <= 25% threshold)
  const smallOrderRes = await fetch(`${baseUrl}/products/${smallDriftProduct._id}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qty: 2 })
  });
  assert(smallOrderRes.status === 200, 'Real POST /products/:id/orders returns 200 OK');

  const acceptRes4 = await fetch(`${baseUrl}/reorder-suggestions/${smallDriftReorder._id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ACCEPTED' })
  });
  assert(acceptRes4.status === 200, `Small stock change: Reorder ACCEPTED with 200 OK (observed: ${acceptRes4.status})`);
  const updatedSmallDrift = await ReorderSuggestion.findById(smallDriftReorder._id);
  assert(updatedSmallDrift.status === 'ACCEPTED', 'Reorder suggestion accepted successfully with small drift');

  // 5. ExpiresAt TTL and Automatic Transition to EXPIRED
  console.log('\n5. TESTING EXPIRESAT TTL & TRANSITION TO EXPIRED VIA HTTP ROUTE...');
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
  const expRes = await fetch(`${baseUrl}/pricing-suggestions/${expiredSuggestion._id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ACCEPTED' })
  });

  assert(expRes.status === 410, `PATCH on expired suggestion rejected with HTTP 410 (observed: ${expRes.status})`);

  server.close();

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
