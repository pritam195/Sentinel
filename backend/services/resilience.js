/**
 * Sentinel Upstream Resilience Layer
 * Provides:
 * 1. Semaphore: Concurrency limiter on LLM calls to respect upstream rate limits
 * 2. Exponential Backoff with Jitter: Bounded retries honoring Retry-After headers
 * 3. Circuit Breaker: CLOSED -> OPEN -> HALF_OPEN state machine to skip LLM calls when degraded
 */

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 10000;
    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.trialInFlight = false;
  }

  getState() {
    if (this.state === 'OPEN') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  canExecute() {
    const currentState = this.getState();
    if (currentState === 'CLOSED') {
      return true;
    }
    if (currentState === 'HALF_OPEN') {
      if (!this.trialInFlight) {
        this.trialInFlight = true;
        return true;
      }
      return false;
    }
    return false; // OPEN
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.trialInFlight = false;
  }

  recordFailure(isTransientUpstream = true) {
    this.trialInFlight = false;
    if (!isTransientUpstream) return;

    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.trialInFlight = false;
  }

  getDetails() {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      lastFailureTime: this.lastFailureTime
    };
  }
}

export class Semaphore {
  constructor(maxConcurrency = 5) {
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
    this.queue = [];
  }

  async acquire(timeoutMs = 30000) {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this.queue.findIndex(item => item.resolve === resolve);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            const err = new Error('Semaphore acquisition timed out waiting in queue');
            err.code = 'TIMEOUT';
            reject(err);
          }
        }, timeoutMs);
      }

      this.queue.push({
        resolve: () => {
          if (timer) clearTimeout(timer);
          this.activeCount++;
          resolve();
        },
        reject
      });
    });
  }

  release() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
      const next = this.queue.shift();
      next.resolve();
    }
  }

  getStats() {
    return {
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      maxConcurrency: this.maxConcurrency
    };
  }

  reset() {
    this.activeCount = 0;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item.reject(new Error('Semaphore reset'));
    }
  }
}

export function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return null;
}

export class RetryHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 10000;
    this.stats = {
      totalCalls: 0,
      totalRetries: 0,
      successfulRetries: 0,
      exhaustedRetries: 0
    };
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = {
      totalCalls: 0,
      totalRetries: 0,
      successfulRetries: 0,
      exhaustedRetries: 0
    };
  }
}

// Global singletons for runtime
export const globalCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  cooldownMs: 10000
});

export const globalSemaphore = new Semaphore(
  parseInt(process.env.LLM_MAX_CONCURRENCY || '5', 10)
);

export const globalRetryHandler = new RetryHandler({
  maxRetries: 3,
  baseDelayMs: 400,
  maxDelayMs: 8000
});

/**
 * Execute an LLM call through the resilience layer:
 * 1. Checks Circuit Breaker (throws CIRCUIT_OPEN if open)
 * 2. Acquires Concurrency Limiter permit (queues if saturated)
 * 3. Bounded exponential backoff with jitter on 429/5xx (honoring Retry-After)
 * 4. Records success/failure on Circuit Breaker and RetryStats
 */
export async function executeWithResilience(fn, options = {}) {
  const breaker = options.circuitBreaker || globalCircuitBreaker;
  const semaphore = options.concurrencyLimiter || globalSemaphore;
  const retryHandler = options.retryHandler || globalRetryHandler;

  // 1. Circuit breaker guard
  if (!breaker.canExecute()) {
    const err = new Error('Circuit breaker is OPEN. Upstream LLM call bypassed.');
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }

  // 2. Concurrency limiter guard
  await semaphore.acquire(options.acquireTimeoutMs || 30000);

  try {
    retryHandler.stats.totalCalls++;
    let attempts = 0;
    const maxRetries = options.maxRetries ?? retryHandler.maxRetries;

    while (true) {
      try {
        const result = await fn();
        if (attempts > 0) {
          retryHandler.stats.successfulRetries++;
        }
        breaker.recordSuccess();
        return result;
      } catch (error) {
        attempts++;
        const status = error.status || error.statusCode || (error.message?.match(/\((\d{3})\)/)?.[1] ? parseInt(error.message.match(/\((\d{3})\)/)[1], 10) : null);
        const isRateLimit = status === 429 || error.code === 'RATE_LIMITED' || /429|resource_exhausted/i.test(error.message);
        const isTransient = isRateLimit || status === 503 || status === 502 || status === 504 || /503|service unavailable|econnrefused|econnreset/i.test(error.message);

        // If not transient or retries exhausted
        if (!isTransient || attempts > maxRetries) {
          breaker.recordFailure(true);
          if (attempts > 1) {
            retryHandler.stats.exhaustedRetries++;
          }

          if (isRateLimit) {
            error.code = 'RATE_LIMITED';
          } else if (error.name === 'AbortError' || /timed out/i.test(error.message)) {
            error.code = 'TIMEOUT';
          } else {
            error.code = 'UPSTREAM_ERROR';
          }
          throw error;
        }

        // Bounded exponential backoff with jitter & Retry-After handling
        retryHandler.stats.totalRetries++;
        const headerVal = error.headers?.get?.('retry-after') || error.retryAfter;
        const retryAfterMs = parseRetryAfter(headerVal);
        const backoffMs = retryAfterMs !== null
          ? retryAfterMs
          : Math.min(
              retryHandler.maxDelayMs,
              retryHandler.baseDelayMs * Math.pow(2, attempts - 1) + Math.random() * 150
            );

        if (options.onRetry) {
          options.onRetry({ attempt: attempts, backoffMs, error });
        }

        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  } finally {
    semaphore.release();
  }
}

