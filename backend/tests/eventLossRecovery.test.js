import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Config from '../models/Config.js';
import { runReconciliationSweep, waitForInFlightToClear } from '../services/recommendationLoop.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const crashWorkerPath = path.resolve(__dirname, 'helpers/crashWorker.js');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

async function setup() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
  await Promise.all([
    PricingSuggestion.syncIndexes(),
    ReorderSuggestion.syncIndexes()
  ]);
  await Config.findOneAndUpdate(
    {},
    { activeStrategy: 'rule-based', demandSpikeMultiplier: 3 },
    { upsert: true }
  );
}

export async function runEventLossRecoveryTests() {
  console.log('===============================================================');
  console.log('     SENTINEL EVENT-LOSS RECOVERY & RECONCILIATION TEST        ');
  console.log('===============================================================');
  await setup();

  let passCount = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passCount++;
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // Ensure category peers exist so category average velocity is calculated properly
  await Product.updateOne(
    { sku: 'RECOVER-CAT-PEER' },
    { name: 'Category Peer', category: 'ELECTRONICS', currentPrice: 50, stockLevel: 100, reorderThreshold: 10, demandVelocity: 5 },
    { upsert: true }
  );

  console.log('\n1. TESTING STOCK MUTATION WITH MID-FLIGHT PROCESS KILL & STARTUP RECOVERY...');
  const testSku = 'RECOVER-LOW-' + Date.now();
  await Product.deleteMany({ sku: { $regex: /^RECOVER-LOW/ } });

  const product = await Product.create({
    sku: testSku,
    name: 'Event Loss Noise Cancelling Headphones',
    category: 'ELECTRONICS',
    currentPrice: 150.00,
    costPrice: 60.00,
    stockLevel: 50, // Normal stock
    reorderThreshold: 20,
    demandVelocity: 2
  });

  console.log(`  Target Product: ${product.sku} (ID: ${product._id})`);
  console.log(`  Spawning worker to mutate stock to 4 (< threshold 20) and crash abruptly...`);

  // Fork crash worker to mutate stock and abruptly terminate before recommendation completes
  const crashWorkerPromise = new Promise((resolve) => {
    const child = fork(crashWorkerPath, [product._id.toString(), '4'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let stdout = '';
    let stderr = '';
    let mutated = false;

    child.on('message', (msg) => {
      if (msg.status === 'STOCK_MUTATED') {
        mutated = true;
      }
    });

    child.on('close', (code, signal) => {
      resolve({ code, signal, mutated, stdout, stderr });
    });
  });

  const workerResult = await crashWorkerPromise;
  assert(workerResult.mutated === true, 'Worker successfully mutated stock level in MongoDB');
  assert(workerResult.code !== 0, `Worker crashed mid-flight with non-zero exit code (got ${workerResult.code})`);

  // Assert state immediately after crash: stock is low in DB, but zero suggestions exist
  const postCrashProduct = await Product.findById(product._id);
  assert(postCrashProduct.stockLevel === 4, `Stock level is mutated to 4 in database (observed: ${postCrashProduct.stockLevel})`);

  const preSweepPricing = await PricingSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  const preSweepReorder = await ReorderSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  assert(preSweepPricing === 0, `Zero pricing suggestions exist after crash (observed: ${preSweepPricing})`);
  assert(preSweepReorder === 0, `Zero reorder suggestions exist after crash (observed: ${preSweepReorder})`);

  // Simulate startup reconciliation sweep
  console.log('\n2. EXECUTING STARTUP RECONCILIATION SWEEP (RE-EMITTING EVENT)...');
  const sweepResult = await runReconciliationSweep({ awaitProcessing: true });
  assert(sweepResult.reconciledCount >= 1, `Reconciliation sweep identified trigger and re-emitted event (reconciled: ${sweepResult.reconciledCount})`);

  // Wait for async handler to settle
  await waitForInFlightToClear(10000);
  await new Promise(r => setTimeout(r, 600));

  // Assert suggestions were created
  const postSweepPricing = await PricingSuggestion.find({ productId: product._id, status: 'PENDING' });
  const postSweepReorder = await ReorderSuggestion.find({ productId: product._id, status: 'PENDING' });

  assert(postSweepPricing.length === 1, `Exactly one PENDING pricing suggestion created after restart sweep (got: ${postSweepPricing.length})`);
  assert(postSweepReorder.length === 1, `Exactly one PENDING reorder suggestion created after restart sweep (got: ${postSweepReorder.length})`);
  assert(postSweepPricing[0].triggerReason === 'INVENTORY_LOW', `Pricing suggestion triggerReason is INVENTORY_LOW (got: ${postSweepPricing[0].triggerReason})`);
  assert(postSweepReorder[0].triggerReason === 'INVENTORY_LOW', `Reorder suggestion triggerReason is INVENTORY_LOW (got: ${postSweepReorder[0].triggerReason})`);

  console.log('\n3. TESTING IDEMPOTENCY OF RECONCILIATION SWEEP (SECOND PASS / NO DUPLICATES)...');
  const secondSweep = await runReconciliationSweep({ awaitProcessing: true });
  await waitForInFlightToClear(5000);
  await new Promise(r => setTimeout(r, 400));

  const secondPricingCount = await PricingSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  const secondReorderCount = await ReorderSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });

  assert(secondPricingCount === 1, `Idempotency verified: exactly 1 pricing suggestion remains (observed: ${secondPricingCount})`);
  assert(secondReorderCount === 1, `Idempotency verified: exactly 1 reorder suggestion remains (observed: ${secondReorderCount})`);

  console.log('\n===============================================================');
  console.log(`EVENT-LOSS RECOVERY TEST SUMMARY: ${passCount}/${totalTests} PASSED (100.0%)`);
  console.log('===============================================================\n');

  return { passCount, totalTests };
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('eventLossRecovery.test.js')) {
  runEventLossRecoveryTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test execution failed:', err);
      process.exit(1);
    });
}
