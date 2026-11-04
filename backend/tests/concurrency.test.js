import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import inventoryEvents from '../events/inventoryEvents.js';
import '../services/recommendationLoop.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Config from '../models/Config.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, 'helpers/eventWorker.js');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

async function setupDatabase() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
  await Promise.all([
    PricingSuggestion.syncIndexes(),
    ReorderSuggestion.syncIndexes()
  ]);
  await Config.findOneAndUpdate({}, { activeStrategy: 'rule-based', demandSpikeMultiplier: 3 }, { upsert: true });
}

/**
 * Suite 1: In-Process Concurrency (Tests inFlightLocks optimization)
 */
export async function testInProcessConcurrency(numEvents = 100) {
  console.log('\n--- SUITE 1: In-Process Concurrency (100 events, 1 process) ---');
  const testSku = 'CONCUR-PROC1-' + Date.now();
  
  await Product.deleteMany({ sku: { $regex: /^CONCUR-PROC1/ } });
  // Ensure peers exist
  await Product.updateOne(
    { sku: 'APP-PEER-FIXED' },
    { name: 'Apparel Peer', category: 'APPAREL', currentPrice: 50, stockLevel: 100, reorderThreshold: 10, demandVelocity: 10 },
    { upsert: true }
  );

  const product = await Product.create({
    sku: testSku,
    name: 'In-Process Concurrency Jacket',
    category: 'APPAREL',
    currentPrice: 80.00,
    costPrice: 35.00,
    stockLevel: 5, // Below threshold 20 -> INVENTORY_LOW
    reorderThreshold: 20,
    demandVelocity: 2 // 2 is well below 3 * avg -> DEMAND_SPIKE will not trigger
  });

  const startTime = Date.now();
  for (let i = 0; i < numEvents; i++) {
    inventoryEvents.emit('inventory:changed', product);
  }

  await new Promise(r => setTimeout(r, 2500));

  const pricingCount = await PricingSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  const reorderCount = await ReorderSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  const elapsedMs = Date.now() - startTime;

  console.log(`  Dispatched: ${numEvents} events | Elapsed: ${elapsedMs}ms`);
  console.log(`  Pending Pricing Suggestions: ${pricingCount} (Expected: 1)`);
  console.log(`  Pending Reorder Suggestions: ${reorderCount} (Expected: 1)`);

  const passed = pricingCount === 1 && reorderCount === 1;
  console.log(`  Suite 1 Status: ${passed ? 'PASSED' : 'FAILED'}`);
  return { passed, pricingCount, reorderCount };
}

/**
 * Suite 2: Multi-Process Concurrency (2+ separate Node processes, 100 events each)
 * Tests MongoDB partial unique index idempotency across isolated process heaps
 */
export async function testMultiProcessConcurrency(numProcesses = 2, eventsPerProcess = 100) {
  console.log(`\n--- SUITE 2: Multi-Process Concurrency (${numProcesses} processes x ${eventsPerProcess} events) ---`);
  const testSku = 'CONCUR-MULTIPROC-' + Date.now();

  await Product.deleteMany({ sku: { $regex: /^CONCUR-MULTIPROC/ } });
  await Product.updateOne(
    { sku: 'ELEC-PEER-FIXED' },
    { name: 'Electronics Peer', category: 'ELECTRONICS', currentPrice: 50, stockLevel: 100, reorderThreshold: 10, demandVelocity: 10 },
    { upsert: true }
  );

  const product = await Product.create({
    sku: testSku,
    name: 'Multi-Process Concurrency Earbuds',
    category: 'ELECTRONICS',
    currentPrice: 90.00,
    costPrice: 40.00,
    stockLevel: 3, // Below threshold 20 -> INVENTORY_LOW
    reorderThreshold: 20,
    demandVelocity: 2
  });

  console.log(`  Target Product: ${product.sku} (ID: ${product._id})`);
  console.log(`  Spawning ${numProcesses} independent Node.js processes...`);

  const startTime = Date.now();
  const childPromises = [];

  for (let p = 0; p < numProcesses; p++) {
    const pIndex = p + 1;
    const promise = new Promise((resolve, reject) => {
      const child = fork(workerPath, [product._id.toString(), String(eventsPerProcess), '0'], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('close', code => {
        if (code === 0) {
          resolve({ pIndex, code, stdout });
        } else {
          reject(new Error(`Worker ${pIndex} exited with code ${code}\nStderr: ${stderr}\nStdout: ${stdout}`));
        }
      });
    });
    childPromises.push(promise);
  }

  const results = await Promise.all(childPromises);
  const elapsedMs = Date.now() - startTime;
  console.log(`  All ${numProcesses} child processes completed in ${elapsedMs}ms.`);

  const pricingCount = await PricingSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  const reorderCount = await ReorderSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });

  console.log(`  Total Events Fired: ${numProcesses * eventsPerProcess}`);
  console.log(`  Pending Pricing Suggestions: ${pricingCount} (Expected: 1)`);
  console.log(`  Pending Reorder Suggestions: ${reorderCount} (Expected: 1)`);

  const passed = pricingCount === 1 && reorderCount === 1;
  console.log(`  Suite 2 Status: ${passed ? 'PASSED' : 'FAILED'}`);
  return { passed, pricingCount, reorderCount, results };
}

/**
 * Suite 3: Mid-Flight Restart
 * Spawns worker, terminates it mid-flight while processing, spawns new worker, asserts idempotency
 */
export async function testMidFlightRestart() {
  console.log('\n--- SUITE 3: Mid-Flight Process Restart Recovery ---');
  const testSku = 'CONCUR-RESTART-' + Date.now();

  await Product.deleteMany({ sku: { $regex: /^CONCUR-RESTART/ } });
  await Product.updateOne(
    { sku: 'HOME-PEER-FIXED' },
    { name: 'Home Peer', category: 'HOME', currentPrice: 50, stockLevel: 100, reorderThreshold: 10, demandVelocity: 10 },
    { upsert: true }
  );

  const product = await Product.create({
    sku: testSku,
    name: 'Mid-Flight Crash Recovery Lamp',
    category: 'HOME',
    currentPrice: 45.00,
    costPrice: 18.00,
    stockLevel: 2, // Below threshold 20 -> INVENTORY_LOW
    reorderThreshold: 20,
    demandVelocity: 2
  });

  console.log(`  Spawning Worker 1 (will be killed mid-flight)...`);
  const worker1 = fork(workerPath, [product._id.toString(), '50', '20'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  // Let worker 1 start processing events, then abruptly kill it
  await new Promise(r => setTimeout(r, 60));
  console.log(`  Killing Worker 1 mid-flight (simulating sudden crash/restart)...`);
  worker1.kill('SIGKILL');

  // Small delay to ensure process termination
  await new Promise(r => setTimeout(r, 100));

  console.log(`  Starting Worker 2 (recovery process firing 100 events)...`);
  const worker2Promise = new Promise((resolve, reject) => {
    const worker2 = fork(workerPath, [product._id.toString(), '100', '0'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let stdout = '';
    let stderr = '';
    worker2.stdout.on('data', d => { stdout += d.toString(); });
    worker2.stderr.on('data', d => { stderr += d.toString(); });

    worker2.on('close', code => {
      if (code === 0) resolve({ code, stdout });
      else reject(new Error(`Worker 2 exited with code ${code}\nStderr: ${stderr}\nStdout: ${stdout}`));
    });
  });

  await worker2Promise;

  const pricingCount = await PricingSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });
  const reorderCount = await ReorderSuggestion.countDocuments({ productId: product._id, status: 'PENDING' });

  console.log(`  Pending Pricing Suggestions: ${pricingCount} (Expected: 1)`);
  console.log(`  Pending Reorder Suggestions: ${reorderCount} (Expected: 1)`);

  const passed = pricingCount === 1 && reorderCount === 1;
  console.log(`  Suite 3 Status: ${passed ? 'PASSED' : 'FAILED'}`);
  return { passed, pricingCount, reorderCount };
}

export async function runAllConcurrencyTests() {
  console.log('===============================================================');
  console.log('        SENTINEL CONCURRENCY & IDEMPOTENCY TEST HARNESS        ');
  console.log('===============================================================');
  await setupDatabase();

  const res1 = await testInProcessConcurrency(100);
  const res2 = await testMultiProcessConcurrency(2, 100);
  const res3 = await testMidFlightRestart();

  const allPassed = res1.passed && res2.passed && res3.passed;

  console.log('\n===============================================================');
  console.log('                     CONCURRENCY TEST SUMMARY                   ');
  console.log('===============================================================');
  console.log(`  Suite 1 (In-Process Concurrency):        ${res1.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`  Suite 2 (Multi-Process Concurrency 2x100): ${res2.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`  Suite 3 (Mid-Flight Crash & Restart):    ${res3.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`  Overall Idempotency Verification:        ${allPassed ? 'VERIFIED (100% CORRECT)' : 'FAILED'}`);
  console.log('===============================================================\n');

  await mongoose.disconnect();
  return allPassed;
}

if (process.argv[1] && process.argv[1].endsWith('concurrency.test.js')) {
  runAllConcurrencyTests()
    .then(passed => {
      process.exit(passed ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}
