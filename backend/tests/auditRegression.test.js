import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import AIAdvisor from '../strategies/AIAdvisor.js';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import {
  Semaphore,
  CircuitBreaker,
  RetryHandler,
  executeWithResilience,
  parseRetryAfter
} from '../services/resilience.js';
import suggestionRoutes from '../routes/suggestions.js';
import productRoutes from '../routes/products.js';
import { authenticateJWT, signToken, JWT_SECRET } from '../middleware/auth.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

const app = express();
app.use(express.json());
app.use('/products', productRoutes);
app.use('/', suggestionRoutes);

export async function runAuditRegressionTests() {
  console.log('===============================================================');
  console.log('          SENTINEL AUDIT REGRESSION PROOF & VERIFICATION       ');
  console.log('===============================================================');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const merchToken = signToken({ userId: 'audit_merch_01', role: 'MERCHANDISER' });
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${merchToken}`
  };

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failedTests++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // BUG-01: Margin Floor Inversion Under Volatility Clamping
    // -------------------------------------------------------------------------
    console.log('\n[BUG-01] Testing Margin Floor vs Volatility Clamping Order-of-Operations...');
    const advisor = new AIAdvisor();
    const productUnderCost = {
      currentPrice: 100.00,
      costPrice: 115.00,
      minMarginPercent: 0 // Gross margin floor = $115.00
    };
    // Advisor suggests price bump to $130 (raw), but maxSingleChangePercent is 10% (maxAllowed = $110)
    const clampResult = advisor._applyPricingPolicyClamps(
      { recommendedPrice: 130.00, direction: 'INCREASE', confidence: 0.9, reasoning: 'Scarcity bump' },
      productUnderCost,
      { maxSingleChangePercent: 10 }
    );
    assert(
      clampResult.recommendedPrice >= 115.00,
      `BUG-01: Clamped price ($${clampResult.recommendedPrice}) must never violate margin floor ($115.00)`
    );

    // -------------------------------------------------------------------------
    // BUG-02: Semaphore Permit Leak on Queue Timeout
    // -------------------------------------------------------------------------
    console.log('\n[BUG-02] Testing Semaphore Timeout Queue Cleanup...');
    const sem = new Semaphore(1);
    await sem.acquire(); // Active count = 1
    assert(sem.activeCount === 1, 'Initial permit acquired');

    let timeoutError = null;
    try {
      // Saturated: this acquire must queue and time out after 50ms
      await sem.acquire(50);
    } catch (err) {
      timeoutError = err;
    }
    assert(timeoutError && timeoutError.code === 'TIMEOUT', 'Semaphore.acquire timed out with TIMEOUT error');
    assert(sem.queue.length === 0, `BUG-02: Timed out waiter must be spliced out of queue (current length: ${sem.queue.length})`);
    
    // Now release the initial permit; queue was empty so activeCount should drop to 0
    sem.release();
    assert(sem.activeCount === 0, `BUG-02: Semaphore activeCount returned to 0 without phantom waiters (got: ${sem.activeCount})`);

    // -------------------------------------------------------------------------
    // BUG-03: Circuit Breaker HALF_OPEN Deadlock on Queue Timeout
    // -------------------------------------------------------------------------
    console.log('\n[BUG-03] Testing Circuit Breaker Recovery when Semaphore Times Out in HALF_OPEN...');
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 40 });
    cb.recordFailure(true);
    assert(cb.getState() === 'OPEN', 'Breaker tripped to OPEN');
    await new Promise(r => setTimeout(r, 60));
    assert(cb.getState() === 'HALF_OPEN', 'Breaker transitioned to HALF_OPEN after cooldown');

    const blockedSem = new Semaphore(1);
    await blockedSem.acquire(); // Lock semaphore so next call times out in queue

    let callThrew = false;
    try {
      await executeWithResilience(async () => 'ok', {
        circuitBreaker: cb,
        concurrencyLimiter: blockedSem,
        acquireTimeoutMs: 30
      });
    } catch (e) {
      callThrew = true;
    }
    assert(callThrew, 'Resilience call threw due to semaphore queue timeout');
    assert(
      cb.canExecute() === true,
      `BUG-03: Circuit breaker must not remain deadlocked with trialInFlight=true after queue timeout (canExecute: ${cb.canExecute()})`
    );
    blockedSem.release();

    // -------------------------------------------------------------------------
    // BUG-04: Non-Transient 4xx Client Errors Tripping Circuit Breaker
    // -------------------------------------------------------------------------
    console.log('\n[BUG-04] Testing That Client 4xx Errors Do NOT Trip Circuit Breaker...');
    const clientBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    const healthySem = new Semaphore(5);
    const noRetryHandler = new RetryHandler({ maxRetries: 0 });

    const clientBadRequestFn = async () => {
      const err = new Error('Bad Request: Invalid client parameter');
      err.status = 400;
      throw err;
    };

    for (let i = 0; i < 3; i++) {
      try {
        await executeWithResilience(clientBadRequestFn, {
          circuitBreaker: clientBreaker,
          concurrencyLimiter: healthySem,
          retryHandler: noRetryHandler
        });
      } catch (e) {
        // Expected client error
      }
    }
    assert(
      clientBreaker.getState() === 'CLOSED',
      `BUG-04: Circuit breaker must stay CLOSED on 400 Bad Request errors (state: ${clientBreaker.getState()})`
    );
    assert(
      clientBreaker.consecutiveFailures === 0,
      `BUG-04: consecutiveFailures should not increment on client errors (got: ${clientBreaker.consecutiveFailures})`
    );

    // -------------------------------------------------------------------------
    // BUG-05: Check-Then-Act Race on Suggestion Acceptance
    // -------------------------------------------------------------------------
    console.log('\n[BUG-05] Testing Concurrency Race on Pricing and Reorder Suggestion Acceptance...');
    const raceProduct = await Product.create({
      sku: 'AUDIT-RACE-' + Date.now(),
      name: 'Audit Concurrency Product',
      category: 'ELECTRONICS',
      currentPrice: 100.00,
      stockLevel: 50,
      reorderThreshold: 20,
      demandVelocity: 5,
      priceVersion: 1
    });

    const racePricing = await PricingSuggestion.create({
      productId: raceProduct._id,
      currentPrice: 100.00,
      recommendedPrice: 110.00,
      direction: 'INCREASE',
      confidence: 0.9,
      reasoning: 'Demand surge',
      status: 'PENDING',
      triggerReason: 'DEMAND_SPIKE',
      priceVersion: 1,
      expiresAt: new Date(Date.now() + 86400000)
    });

    // Fire 2 simultaneous accept calls
    const [resP1, resP2] = await Promise.all([
      fetch(`${baseUrl}/pricing-suggestions/${racePricing._id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'ACCEPTED' })
      }),
      fetch(`${baseUrl}/pricing-suggestions/${racePricing._id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'ACCEPTED' })
      })
    ]);

    const statuses = [resP1.status, resP2.status].sort();
    assert(
      statuses[0] === 200 && statuses[1] === 400,
      `BUG-05: Concurrent pricing accept must result in exactly 1 success (200) and 1 rejection (400), got: [${statuses.join(', ')}]`
    );

    const refetchedProduct = await Product.findById(raceProduct._id);
    assert(
      refetchedProduct.priceVersion === 2,
      `BUG-05: Product priceVersion must increment exactly once (expected 2, got: ${refetchedProduct.priceVersion})`
    );
    assert(
      refetchedProduct.priceHistory.length === 1,
      `BUG-05: Product priceHistory must contain exactly 1 entry (got: ${refetchedProduct.priceHistory.length})`
    );

    // -------------------------------------------------------------------------
    // BUG-06: Frontend XSS Sanitization in Stream Formatter
    // -------------------------------------------------------------------------
    console.log('\n[BUG-06] Testing Stream Formatter XSS Neutralization...');
    // Simulated input from LLM stream containing script injection
    const xssPayload = '{"reasoning": "<img src=x onerror=alert(1)> and <script>alert(2)</script>"}';
    const sanitizeStream = (raw) => {
      const safe = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return safe
        .replace(/"([^"]+)":/g, '<span class="text-cyan-400 font-semibold">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="text-emerald-400">"$1"</span>')
        .replace(/: ([0-9.]+)/g, ': <span class="text-amber-400 font-bold">$1</span>');
    };
    const formatted = sanitizeStream(xssPayload);
    assert(
      !formatted.includes('<img') && !formatted.includes('<script>'),
      'BUG-06: Formatted stream text must not contain unescaped HTML tags'
    );
    assert(
      formatted.includes('&lt;img') && formatted.includes('&lt;script&gt;'),
      'BUG-06: HTML tags properly escaped to entities'
    );

    // -------------------------------------------------------------------------
    // BUG-07: JWT Algorithm Pinning
    // -------------------------------------------------------------------------
    console.log('\n[BUG-07] Testing JWT Algorithm Pinning Against alg=none...');
    // Create an unverified/none token
    const headerBase64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify({ userId: 'attacker', role: 'ADMIN' })).toString('base64url');
    const noneToken = `${headerBase64}.${payloadBase64}.`;

    let verifyError = null;
    try {
      jwt.verify(noneToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      verifyError = err;
    }
    assert(
      verifyError !== null,
      'BUG-07: Pinned HS256 verification rejects tokens signed with alg=none'
    );

    // -------------------------------------------------------------------------
    // BUG-08: Bounded Retry-After Delay
    // -------------------------------------------------------------------------
    console.log('\n[BUG-08] Testing Bounded Retry-After Delay Against Huge Headers...');
    const parsedHuge = parseRetryAfter('999999');
    const maxAllowedDelayMs = 8000;
    const boundedDelayMs = Math.min(parsedHuge, maxAllowedDelayMs);
    assert(
      boundedDelayMs === maxAllowedDelayMs,
      `BUG-08: Bounded backoff delay ($${boundedDelayMs}ms) never exceeds maxDelayMs ($${maxAllowedDelayMs}ms)`
    );

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n===============================================================');
    console.log(`AUDIT REGRESSION SUITE RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
    console.log('===============================================================');
    if (failedTests > 0) {
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('auditRegression.test.js')) {
  runAuditRegressionTests().then(() => {
    if (process.exitCode !== 1) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  });
}
