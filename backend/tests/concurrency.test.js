import mongoose from 'mongoose';
import dotenv from 'dotenv';
import inventoryEvents from '../events/inventoryEvents.js';
import '../services/recommendationLoop.js'; // initialize listener
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Config from '../models/Config.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

export async function runConcurrencyTest(numEvents = 100) {
  console.log('===============================================================');
  console.log('        SENTINEL CONCURRENCY & IDEMPOTENCY TEST HARNESS        ');
  console.log('===============================================================');
  console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);

  // Set active strategy to rule-based for deterministic, fast execution of 100 concurrent events
  await Config.findOneAndUpdate({}, { activeStrategy: 'rule-based', demandSpikeMultiplier: 3 }, { upsert: true });

  const testSku = 'CONCUR-TEST-' + Date.now();
  
  // Clean up any previous test product
  await Product.deleteMany({ sku: { $regex: /^CONCUR-TEST/ } });

  // Create a product in low stock and demand spike state
  // Category average will be calculated from products in same category
  await Product.deleteMany({ category: 'APPAREL' });
  await Product.create([
    { sku: 'APPAREL-PEER-1', name: 'Apparel Peer 1', category: 'APPAREL', currentPrice: 20, stockLevel: 50, reorderThreshold: 10, demandVelocity: 2 },
    { sku: 'APPAREL-PEER-2', name: 'Apparel Peer 2', category: 'APPAREL', currentPrice: 25, stockLevel: 40, reorderThreshold: 10, demandVelocity: 4 }
  ]);

  const testProduct = await Product.create({
    sku: testSku,
    name: 'Rapid Fire Concurrency Hoodie',
    category: 'APPAREL',
    currentPrice: 60.00,
    costPrice: 25.00,
    stockLevel: 4, // Below reorderThreshold (20) -> INVENTORY_LOW trigger
    reorderThreshold: 20,
    demandVelocity: 30 // 30 > 3 * avg(3) -> DEMAND_SPIKE trigger
  });

  console.log(`Created test product ${testProduct.sku} (ID: ${testProduct._id})`);
  console.log(`Trigger conditions active: INVENTORY_LOW (stock 4 < threshold 20), DEMAND_SPIKE (velocity 30 > 3 * peer avg 3)`);
  console.log(`\nFiring ${numEvents} simultaneous concurrent 'inventory:changed' events...`);

  const startTime = Date.now();

  // Fire all concurrent events without delay
  for (let i = 0; i < numEvents; i++) {
    inventoryEvents.emit('inventory:changed', testProduct);
  }

  // Wait for all async listeners on the event loop to settle
  console.log('Events dispatched. Waiting for async processing to settle...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Query database to evaluate suggestions
  const pricingSuggestions = await PricingSuggestion.find({ productId: testProduct._id });
  const reorderSuggestions = await ReorderSuggestion.find({ productId: testProduct._id });

  const elapsedMs = Date.now() - startTime;

  console.log('\n--- CONCURRENCY TEST RESULTS ---');
  console.log(`Total concurrent events dispatched: ${numEvents}`);
  console.log(`Total elapsed time: ${elapsedMs}ms`);

  // Analyze duplicates
  const pricingByTrigger = {};
  for (const s of pricingSuggestions) {
    pricingByTrigger[s.triggerReason] = (pricingByTrigger[s.triggerReason] || 0) + 1;
  }

  const reorderByTrigger = {};
  for (const s of reorderSuggestions) {
    reorderByTrigger[s.triggerReason] = (reorderByTrigger[s.triggerReason] || 0) + 1;
  }

  let duplicatePricing = 0;
  let duplicateReorder = 0;

  for (const [trigger, count] of Object.entries(pricingByTrigger)) {
    console.log(`  Pricing suggestions for [${trigger}]: ${count} (Expected: 1)`);
    if (count > 1) duplicatePricing += (count - 1);
  }

  for (const [trigger, count] of Object.entries(reorderByTrigger)) {
    console.log(`  Reorder suggestions for [${trigger}]: ${count} (Expected: 1)`);
    if (count > 1) duplicateReorder += (count - 1);
  }

  const totalDuplicates = duplicatePricing + duplicateReorder;
  const isIdempotent = totalDuplicates === 0 && pricingSuggestions.length > 0 && reorderSuggestions.length > 0;

  console.log('---------------------------------------------------------------');
  console.log(`TOTAL EVENTS PROCESSED: ${numEvents}`);
  console.log(`TOTAL PRICING SUGGESTIONS CREATED: ${pricingSuggestions.length}`);
  console.log(`TOTAL REORDER SUGGESTIONS CREATED: ${reorderSuggestions.length}`);
  console.log(`TOTAL DUPLICATES DETECTED: ${totalDuplicates}`);
  console.log(`IDEMPOTENCY CLAIM STATUS: ${isIdempotent ? 'VERIFIED (PASSED)' : 'FAILED'}`);
  console.log('---------------------------------------------------------------\n');

  return {
    numEvents,
    elapsedMs,
    totalPricingSuggestions: pricingSuggestions.length,
    totalReorderSuggestions: reorderSuggestions.length,
    totalDuplicates,
    isIdempotent,
    pricingByTrigger,
    reorderByTrigger
  };
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('concurrency.test.js')) {
  runConcurrencyTest(100)
    .then((res) => {
      if (!res.isIdempotent) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Concurrency test error:', err);
      process.exit(1);
    });
}
