import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { performance } from 'perf_hooks';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import Config from '../models/Config.js';
import AdvisorLog from '../models/AdvisorLog.js';
import inventoryEvents from '../events/inventoryEvents.js';
import { inFlightLocks } from '../services/recommendationLoop.js';
import { recordInventorySnapshot } from '../services/inventorySnapshots.js';
import { getMetricsSummary } from '../services/metrics.js';
import {
  globalCircuitBreaker,
  globalSemaphore,
  globalRetryHandler
} from '../services/resilience.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

const CATEGORIES = ['ELECTRONICS', 'APPAREL', 'HOME'];

const PRODUCT_TEMPLATES = {
  ELECTRONICS: [
    { prefix: 'Headphones', priceRange: [50, 250], costRatio: 0.5 },
    { prefix: 'Smartwatch', priceRange: [120, 350], costRatio: 0.55 },
    { prefix: 'USB Cable', priceRange: [12, 30], costRatio: 0.35 },
    { prefix: 'Power Bank', priceRange: [25, 80], costRatio: 0.45 },
    { prefix: 'Webcam 4K', priceRange: [60, 180], costRatio: 0.5 },
    { prefix: 'Wireless Keyboard', priceRange: [40, 130], costRatio: 0.48 }
  ],
  APPAREL: [
    { prefix: 'Cotton T-Shirt', priceRange: [18, 45], costRatio: 0.4 },
    { prefix: 'Denim Jeans', priceRange: [50, 110], costRatio: 0.42 },
    { prefix: 'Hoodie Fleece', priceRange: [45, 95], costRatio: 0.45 },
    { prefix: 'Running Shoes', priceRange: [70, 160], costRatio: 0.48 },
    { prefix: 'Wool Beanie', priceRange: [15, 35], costRatio: 0.35 },
    { prefix: 'Athletic Shorts', priceRange: [25, 55], costRatio: 0.38 }
  ],
  HOME: [
    { prefix: 'Coffee Maker', priceRange: [35, 120], costRatio: 0.5 },
    { prefix: 'Ceramic Mug Set', priceRange: [20, 45], costRatio: 0.35 },
    { prefix: 'Desk Lamp LED', priceRange: [30, 85], costRatio: 0.45 },
    { prefix: 'Cast Iron Skillet', priceRange: [28, 75], costRatio: 0.4 },
    { prefix: 'Throw Pillow Linen', priceRange: [18, 40], costRatio: 0.35 },
    { prefix: 'Soy Scented Candle', priceRange: [14, 32], costRatio: 0.32 }
  ]
};

function generate500Products(count = 520) {
  const products = [];
  for (let i = 1; i <= count; i++) {
    const category = CATEGORIES[(i - 1) % CATEGORIES.length];
    const templates = PRODUCT_TEMPLATES[category];
    const template = templates[i % templates.length];
    
    const minPrice = template.priceRange[0];
    const maxPrice = template.priceRange[1];
    const price = Math.round((minPrice + Math.random() * (maxPrice - minPrice)) * 100) / 100;
    const cost = Math.round(price * template.costRatio * 100) / 100;

    // Distribute stock states: 12% critical/low, 15% demand surge, 73% normal
    let stockLevel;
    let demandVelocity;
    const rand = Math.random();

    if (rand < 0.12) {
      stockLevel = Math.floor(Math.random() * 8) + 1; // 1 to 8
      demandVelocity = Math.floor(Math.random() * 8) + 3;
    } else if (rand < 0.27) {
      stockLevel = Math.floor(Math.random() * 30) + 15;
      demandVelocity = Math.floor(Math.random() * 20) + 15; // 15 to 35
    } else {
      stockLevel = Math.floor(Math.random() * 80) + 20;
      demandVelocity = Math.floor(Math.random() * 5) + 1;
    }

    const reorderThreshold = 20;

    products.push({
      sku: `SKU-${category.substring(0, 4)}-${String(i).padStart(4, '0')}`,
      name: `${template.prefix} Model ${i}`,
      category,
      currentPrice: price,
      costPrice: cost,
      stockLevel,
      reorderThreshold,
      demandVelocity,
      status: stockLevel === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
      priceHistory: [{ price, date: new Date() }]
    });
  }
  return products;
}

export async function runLoadAndScaleTest(targetProductCount = 520, numOrderSimulations = 150) {
  console.log('===============================================================');
  console.log('             SENTINEL SCALE & LOAD TEST HARNESS                ');
  console.log('===============================================================');
  console.log(`Connecting to MongoDB: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);

  // Configure engine to test both AI and Rules under load
  await Config.findOneAndUpdate({}, { activeStrategy: 'ai', demandSpikeMultiplier: 3 }, { upsert: true });

  // Reset resilience tracking
  globalCircuitBreaker.reset();
  globalSemaphore.reset();
  globalRetryHandler.resetStats();

  console.log(`\n1. SEEDING CATALOG WITH ${targetProductCount} PRODUCTS...`);
  await Product.deleteMany({ sku: { $regex: /^SKU-/ } });
  await PricingSuggestion.deleteMany({});
  await ReorderSuggestion.deleteMany({});
  await InventorySnapshot.deleteMany({});
  await AdvisorLog.deleteMany({});

  const generatedData = generate500Products(targetProductCount);
  const seedStartTime = performance.now();
  const createdProducts = await Product.insertMany(generatedData);
  const seedTimeMs = performance.now() - seedStartTime;

  console.log(`Successfully seeded ${createdProducts.length} products in ${seedTimeMs.toFixed(1)}ms.`);
  const categoryCounts = {};
  for (const p of createdProducts) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }
  console.log('Category distribution:', categoryCounts);

  // 2. MEASURING DB WRITE OVERHEAD OF INVENTORY SNAPSHOT AUDIT TRAIL
  console.log('\n2. EVALUATING INVENTORY SNAPSHOT AUDIT TRAIL OVERHEAD...');
  const snapshotBenchmarkCount = 100;
  const testSample = createdProducts.slice(0, snapshotBenchmarkCount);

  // Phase A: Pure product updates without snapshot
  const t0 = performance.now();
  for (let i = 0; i < testSample.length; i++) {
    await Product.updateOne({ _id: testSample[i]._id }, { $inc: { stockLevel: -1 } });
  }
  const pureUpdateMs = performance.now() - t0;

  // Phase B: Product updates WITH InventorySnapshot creation
  const t1 = performance.now();
  for (let i = 0; i < testSample.length; i++) {
    await Product.updateOne({ _id: testSample[i]._id }, { $inc: { stockLevel: -1 } });
    await recordInventorySnapshot(testSample[i], 'ORDER');
  }
  const updateWithSnapshotMs = performance.now() - t1;
  const snapshotNetOverheadMs = updateWithSnapshotMs - pureUpdateMs;
  const snapshotAvgOverheadPerWriteMs = snapshotNetOverheadMs / snapshotBenchmarkCount;

  console.log(`  - 100 DB Product Updates (Baseline): ${pureUpdateMs.toFixed(2)}ms (${(pureUpdateMs / snapshotBenchmarkCount).toFixed(2)}ms/write)`);
  console.log(`  - 100 DB Updates + Snapshot Audit:   ${updateWithSnapshotMs.toFixed(2)}ms (${(updateWithSnapshotMs / snapshotBenchmarkCount).toFixed(2)}ms/write)`);
  console.log(`  - Snapshot Write Overhead:           +${snapshotNetOverheadMs.toFixed(2)}ms total (+${snapshotAvgOverheadPerWriteMs.toFixed(2)}ms per write, ${((snapshotNetOverheadMs / pureUpdateMs) * 100).toFixed(1)}% write overhead)`);

  // 3. RUNNING BATCH OF SIMULATED ORDERS & STOCK MOVEMENTS
  console.log(`\n3. EXECUTING BATCH OF ${numOrderSimulations} SIMULATED ORDERS & STOCK MOVEMENTS...`);
  const simStartTime = performance.now();

  let orderCount = 0;
  for (let i = 0; i < numOrderSimulations; i++) {
    const product = createdProducts[Math.floor(Math.random() * createdProducts.length)];
    const qty = Math.floor(Math.random() * 4) + 1; // 1 to 4 units

    product.stockLevel = Math.max(0, product.stockLevel - qty);
    product.demandVelocity += qty;

    await product.save();
    await recordInventorySnapshot(product, 'ORDER');
    orderCount++;

    // Emit event into recommendation loop
    inventoryEvents.emit('inventory:changed', product);

    // Yield small time every 10 events to allow async loop concurrency
    if (i % 10 === 0) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  console.log(`Dispatched ${orderCount} order operations. Waiting for async advisor loop to settle...`);
  const waitStart = performance.now();
  while (inFlightLocks.size > 0 && performance.now() - waitStart < 25000) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1000));

  const totalSimElapsedMs = performance.now() - simStartTime;

  // 4. AGGREGATING FINAL METRICS
  const finalPricingCount = await PricingSuggestion.countDocuments({});
  const finalReorderCount = await ReorderSuggestion.countDocuments({});
  const finalSnapshotCount = await InventorySnapshot.countDocuments({});
  const metricsSummary = await getMetricsSummary();
  const retryStats = globalRetryHandler.getStats();
  const breakerDetails = globalCircuitBreaker.getDetails();

  // Aggregate fallback reasons
  const fallbackAgg = await AdvisorLog.aggregate([
    { $match: { fellBack: true, fallbackReason: { $ne: null } } },
    { $group: { _id: '$fallbackReason', count: { $sum: 1 } } }
  ]);
  const fallbackBreakdown = {};
  for (const item of fallbackAgg) {
    fallbackBreakdown[item._id] = item.count;
  }

  const callsBypassedByBreaker = fallbackBreakdown.CIRCUIT_OPEN || 0;
  const callsReachedGemini = Math.max(0, metricsSummary.totalAICalls - callsBypassedByBreaker);

  console.log('\n===============================================================');
  console.log('                 SCALE & LOAD TEST RESULTS                     ');
  console.log('===============================================================');
  console.log(`Total Products in Catalog:         ${createdProducts.length}`);
  console.log(`Total Orders Simulated:            ${orderCount}`);
  console.log(`Total Inventory Snapshots Stored:  ${finalSnapshotCount}`);
  console.log(`Total Pricing Suggestions:         ${finalPricingCount}`);
  console.log(`Total Reorder Suggestions:         ${finalReorderCount}`);
  console.log(`Total Suggestions Generated:       ${finalPricingCount + finalReorderCount}`);
  console.log(`Total Triggers Fired:              ${metricsSummary.totalTriggers}`);
  console.log('Triggers by Type:', metricsSummary.triggersByType);
  console.log('\n--- UPSTREAM RESILIENCE & ADVISOR METRICS ---');
  console.log(`Total Advisor Requests:            ${metricsSummary.totalAICalls}`);
  console.log(`Calls that reached Gemini API:     ${callsReachedGemini}`);
  console.log(`Calls bypassed by Circuit Breaker: ${callsBypassedByBreaker}`);
  console.log(`Total Retry Attempts:              ${retryStats.totalRetries}`);
  console.log(`Retried Successfully:              ${retryStats.successfulRetries}`);
  console.log(`Exhausted Retries:                 ${retryStats.exhaustedRetries}`);
  console.log(`Total Fell Back:                   ${metricsSummary.fallbackCount}`);
  console.log(`AI Fallback Rate:                  ${metricsSummary.fallbackRatePct}%`);
  console.log('Fallback Count by Reason:', fallbackBreakdown);
  console.log(`Circuit Breaker State:             ${breakerDetails.state}`);
  console.log(`AI Latency (Min):                  ${metricsSummary.latency.minMs.toFixed(2)}ms`);
  console.log(`AI Latency (Median):               ${metricsSummary.latency.medianMs.toFixed(2)}ms`);
  console.log(`AI Latency (P90):                  ${metricsSummary.latency.p90Ms.toFixed(2)}ms`);
  console.log(`AI Latency (P95):                  ${metricsSummary.latency.p95Ms.toFixed(2)}ms`);
  console.log(`AI Latency (P99):                  ${metricsSummary.latency.p99Ms.toFixed(2)}ms`);
  console.log(`AI Latency (Max):                  ${metricsSummary.latency.maxMs.toFixed(2)}ms`);
  console.log('\n--- AUDIT TRAIL OVERHEAD ---');
  console.log(`Baseline Update Latency:          ${(pureUpdateMs / snapshotBenchmarkCount).toFixed(2)}ms`);
  console.log(`Snapshot + Update Latency:         ${(updateWithSnapshotMs / snapshotBenchmarkCount).toFixed(2)}ms`);
  console.log(`Incremental Snapshot Overhead:     +${snapshotAvgOverheadPerWriteMs.toFixed(2)}ms per write`);
  console.log('===============================================================\n');

  return {
    productCount: createdProducts.length,
    ordersSimulated: orderCount,
    snapshotsStored: finalSnapshotCount,
    pricingSuggestions: finalPricingCount,
    reorderSuggestions: finalReorderCount,
    totalSuggestions: finalPricingCount + finalReorderCount,
    triggers: metricsSummary.totalTriggers,
    triggersByType: metricsSummary.triggersByType,
    aiCalls: metricsSummary.totalAICalls,
    callsReachedGemini,
    callsBypassedByBreaker,
    retryStats,
    fallbackCount: metricsSummary.fallbackCount,
    fallbackRatePct: metricsSummary.fallbackRatePct,
    fallbackBreakdown,
    breakerState: breakerDetails.state,
    latency: metricsSummary.latency,
    snapshotOverhead: {
      pureUpdatePerWriteMs: (pureUpdateMs / snapshotBenchmarkCount).toFixed(2),
      updateWithSnapshotPerWriteMs: (updateWithSnapshotMs / snapshotBenchmarkCount).toFixed(2),
      incrementalOverheadMs: snapshotAvgOverheadPerWriteMs.toFixed(2),
      overheadPct: ((snapshotNetOverheadMs / pureUpdateMs) * 100).toFixed(1)
    }
  };
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('loadTest.test.js')) {
  runLoadAndScaleTest(520, 150)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Load test error:', err);
      process.exit(1);
    });
}
