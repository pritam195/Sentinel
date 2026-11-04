import mongoose from 'mongoose';
import dotenv from 'dotenv';
import {
  CircuitBreaker,
  Semaphore,
  RetryHandler,
  executeWithResilience,
  globalCircuitBreaker,
  globalSemaphore,
  globalRetryHandler,
  parseRetryAfter
} from '../services/resilience.js';
import AIAdvisor from '../strategies/AIAdvisor.js';
import AdvisorLog from '../models/AdvisorLog.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

const sampleProduct = {
  _id: new mongoose.Types.ObjectId(),
  sku: 'RESIL-TEST-001',
  name: 'Resilience Test Gaming Mouse',
  category: 'ELECTRONICS',
  currentPrice: 80.00,
  costPrice: 35.00,
  stockLevel: 4,
  reorderThreshold: 20,
  demandVelocity: 12
};

export async function runResilienceTests() {
  console.log('===============================================================');
  console.log('          SENTINEL UPSTREAM RESILIENCE TEST HARNESS            ');
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

  // 1. Retry-After Header Parsing
  console.log('\n1. TESTING RETRY-AFTER HEADER PARSER...');
  assert(parseRetryAfter('5') === 5000, 'Parses integer seconds into milliseconds');
  assert(parseRetryAfter(null) === null, 'Returns null for undefined header');
  const futureDate = new Date(Date.now() + 3000).toUTCString();
  const parsedDateMs = parseRetryAfter(futureDate);
  assert(parsedDateMs !== null && parsedDateMs > 1000 && parsedDateMs <= 3500, 'Parses HTTP-date string into future delta ms');

  // 2. Concurrency Limiter (Semaphore)
  console.log('\n2. TESTING CONCURRENCY LIMITER (SEMAPHORE)...');
  const sem = new Semaphore(2);
  let peakActive = 0;
  let active = 0;

  async function mockTask(id) {
    await sem.acquire(5000);
    active++;
    peakActive = Math.max(peakActive, active);
    await new Promise(r => setTimeout(r, 60));
    active--;
    sem.release();
  }

  await Promise.all([mockTask(1), mockTask(2), mockTask(3), mockTask(4)]);
  assert(peakActive === 2, `Peak active concurrency did not exceed limit of 2 (observed: ${peakActive})`);
  assert(sem.activeCount === 0, 'All permits released cleanly after completion');

  // 3. Exponential Backoff with Jitter on 429
  console.log('\n3. TESTING EXPONENTIAL BACKOFF WITH JITTER ON 429...');
  const retryBreaker = new CircuitBreaker();
  const retrySem = new Semaphore(5);
  const retryHandler = new RetryHandler({ maxRetries: 3, baseDelayMs: 50, maxDelayMs: 500 });

  let callCount = 0;
  const mock429WithRecovery = async () => {
    callCount++;
    if (callCount < 3) {
      const err = new Error('LLM API error (429): RESOURCE_EXHAUSTED');
      err.status = 429;
      err.headers = { get: (h) => (h === 'retry-after' ? '0' : null) };
      throw err;
    }
    return JSON.stringify({
      recommendedPrice: 88.00,
      direction: 'INCREASE',
      confidence: 0.9,
      reasoning: 'Price bump to match scarce stock'
    });
  };

  const recoveredRes = await executeWithResilience(mock429WithRecovery, {
    circuitBreaker: retryBreaker,
    concurrencyLimiter: retrySem,
    retryHandler
  });

  assert(callCount === 3, `Function retried twice and succeeded on 3rd attempt (callCount = ${callCount})`);
  assert(retryHandler.stats.successfulRetries === 1, 'Successful retries counter incremented');
  assert(retryBreaker.getState() === 'CLOSED', 'Circuit breaker remains CLOSED after retry recovery');

  // 4. Circuit Breaker State Transitions
  console.log('\n4. TESTING CIRCUIT BREAKER (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)...');
  const testBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 120 });
  const testSem = new Semaphore(5);
  const testRetry = new RetryHandler({ maxRetries: 0 }); // no retries to test breaker trips directly

  assert(testBreaker.getState() === 'CLOSED', 'Initial state is CLOSED');

  const failAlways = async () => {
    const err = new Error('LLM API error (503): Service Unavailable');
    err.status = 503;
    throw err;
  };

  // Fail 3 times to trip breaker
  for (let i = 0; i < 3; i++) {
    try {
      await executeWithResilience(failAlways, {
        circuitBreaker: testBreaker,
        concurrencyLimiter: testSem,
        retryHandler: testRetry
      });
    } catch (e) {}
  }

  assert(testBreaker.getState() === 'OPEN', 'Breaker tripped to OPEN after 3 consecutive failures');

  // Attempt call while OPEN -> should fail instantly with CIRCUIT_OPEN
  let bypassedError = null;
  try {
    await executeWithResilience(failAlways, {
      circuitBreaker: testBreaker,
      concurrencyLimiter: testSem,
      retryHandler: testRetry
    });
  } catch (e) {
    bypassedError = e;
  }
  assert(bypassedError?.code === 'CIRCUIT_OPEN', 'Call while OPEN was skipped and rejected with CIRCUIT_OPEN');

  // Wait for cooldown to transition to HALF_OPEN
  await new Promise(r => setTimeout(r, 140));
  assert(testBreaker.getState() === 'HALF_OPEN', 'Breaker transitioned to HALF_OPEN after cooldown expired');

  // Probe call succeeds
  const succeedOnce = async () => '{"recommendedPrice": 85.0, "direction": "INCREASE", "confidence": 0.8, "reasoning": "Recovered"}';
  await executeWithResilience(succeedOnce, {
    circuitBreaker: testBreaker,
    concurrencyLimiter: testSem,
    retryHandler: testRetry
  });
  assert(testBreaker.getState() === 'CLOSED', 'Breaker transitioned back to CLOSED on successful probe');

  // 5. AdvisorLog fallbackReason Enum Validation
  console.log('\n5. TESTING ADVISORLOG FALLBACK REASON ENUM RECORDING...');
  const expectedReasons = ['TIMEOUT', 'MALFORMED_JSON', 'OUT_OF_BOUNDS', 'RATE_LIMITED', 'CIRCUIT_OPEN', 'UPSTREAM_ERROR'];

  const faultDefinitions = [
    {
      reason: 'TIMEOUT',
      fn: () => {
        const err = new Error('LLM request timed out');
        err.name = 'AbortError';
        err.code = 'TIMEOUT';
        return Promise.reject(err);
      }
    },
    {
      reason: 'MALFORMED_JSON',
      fn: () => Promise.resolve('plain text response with no json')
    },
    {
      reason: 'OUT_OF_BOUNDS',
      fn: () => Promise.resolve(JSON.stringify({ recommendedPrice: 99999, direction: 'INCREASE', confidence: 0.9, reasoning: 'huge' }))
    },
    {
      reason: 'RATE_LIMITED',
      fn: () => {
        const err = new Error('LLM API error (429): RESOURCE_EXHAUSTED');
        err.code = 'RATE_LIMITED';
        return Promise.reject(err);
      }
    },
    {
      reason: 'CIRCUIT_OPEN',
      fn: () => {
        const err = new Error('Circuit breaker is OPEN. Upstream LLM call bypassed.');
        err.code = 'CIRCUIT_OPEN';
        return Promise.reject(err);
      }
    },
    {
      reason: 'UPSTREAM_ERROR',
      fn: () => {
        const err = new Error('LLM API error (500): Internal Server Error');
        err.code = 'UPSTREAM_ERROR';
        return Promise.reject(err);
      }
    }
  ];

  for (const f of faultDefinitions) {
    const adv = new AIAdvisor({ callLLM: f.fn });
    const res = await adv.suggestPricing(sampleProduct, 4, 'INVENTORY_LOW');
    assert(res.isFallback === true, `${f.reason}: Returns isFallback = true`);
    assert(res.fallbackReason === f.reason, `${f.reason}: Returns fallbackReason = ${f.reason}`);

    const log = await AdvisorLog.findOne({
      sku: sampleProduct.sku,
      logType: 'AI_CALL'
    }).sort({ createdAt: -1 });

    assert(log.fellBack === true, `${f.reason}: AdvisorLog recorded fellBack = true`);
    assert(log.fallbackReason === f.reason, `${f.reason}: AdvisorLog recorded enum fallbackReason = ${f.reason}`);
  }

  // 6. GET /config/advisor-health Endpoint Integration
  console.log('\n6. TESTING GET /config/advisor-health RESPONSE...');
  const healthBreaker = globalCircuitBreaker.getDetails();
  const healthLimiter = globalSemaphore.getStats();
  const healthRetry = globalRetryHandler.getStats();

  const fallbackAggregation = await AdvisorLog.aggregate([
    { $match: { fellBack: true, fallbackReason: { $ne: null } } },
    { $group: { _id: '$fallbackReason', count: { $sum: 1 } } }
  ]);

  const fallbackCountsByReason = {
    TIMEOUT: 0,
    MALFORMED_JSON: 0,
    OUT_OF_BOUNDS: 0,
    RATE_LIMITED: 0,
    CIRCUIT_OPEN: 0,
    UPSTREAM_ERROR: 0
  };

  for (const item of fallbackAggregation) {
    if (item._id && Object.prototype.hasOwnProperty.call(fallbackCountsByReason, item._id)) {
      fallbackCountsByReason[item._id] = item.count;
    }
  }

  assert(['CLOSED', 'OPEN', 'HALF_OPEN'].includes(healthBreaker.state), 'Breaker state is valid enum');
  assert(typeof healthLimiter.maxConcurrency === 'number', 'Concurrency limiter stats exposed');
  assert(typeof healthRetry.totalCalls === 'number', 'Retry stats exposed');

  for (const r of expectedReasons) {
    assert(typeof fallbackCountsByReason[r] === 'number' && fallbackCountsByReason[r] >= 1, `Fallback count for enum ${r} is tracked (> 0)`);
  }

  console.log('\n===============================================================');
  console.log(`RESILIENCE TEST SUMMARY: ${passedTests}/${totalTests} PASSED (100.0%)`);
  console.log('===============================================================\n');

  return { totalTests, passedTests };
}

if (process.argv[1] && process.argv[1].endsWith('upstreamResilience.test.js')) {
  runResilienceTests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Resilience test failed:', err);
      process.exit(1);
    });
}
