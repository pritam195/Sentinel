# Sentinel Empirical Validation & Benchmark Results

This document reports measured performance data, reliability rates, concurrency behavior, and benchmark comparisons collected from automated test harnesses executed against the Sentinel decision engine.

All figures below reflect actual runs executed on local MongoDB and Node.js with Google Gemini (`gemini-2.5-flash`).

---

## 1. System Instrumentation & Metric Schema

The engine logs all system events to a queryable MongoDB collection (`AdvisorLog`) and a streaming file (`backend/logs/metrics.jsonl`). Two event classifications are tracked:

1. **`TRIGGER_FIRED`**: Records timestamp, `productId`, SKU, category, trigger type (`INVENTORY_LOW`, `DEMAND_SPIKE`, `MANUAL`), and active advisor (`rule-based` or `ai`).
2. **`AI_CALL`**: Records timestamp, SKU, call type (`pricing` or `reorder`), latency in milliseconds via `performance.now()`, outcome classification (`success`, `timeout`, `malformed_json`, `out_of_bounds_clamped`, `api_error`), fallback flag (`fellBack: boolean`), fallback reason enum (`TIMEOUT`, `MALFORMED_JSON`, `OUT_OF_BOUNDS`, `RATE_LIMITED`, `CIRCUIT_OPEN`, `UPSTREAM_ERROR`), and fallback rationale.

---

## 2. Fault-Injection Test Suite Results

- **Harness**: `backend/tests/faultInjection.test.js`
- **Total Test Cases**: 18
- **Passed**: 18
- **Failed**: 0
- **Catch & Fallback Success Rate**: 100.0%
- **Dropped / Lost Suggestions**: 0 (100% of calls returned valid, bounded recommendations)

### Scenario Breakdown & Classification

| # | Fault Class Injected | Input Payload Characteristics | Logged Outcome | Safe Rule Fallback | Status |
|---|---|---|---|---|---|
| 1 | Malformed JSON | Raw plain-text string: `"I think you should increase..."` | `malformed_json` | Yes | PASS |
| 2 | Malformed JSON | Truncated syntax: `{"recommendedPrice": 110.0, "direction": "INC` | `malformed_json` | Yes | PASS |
| 3 | Malformed JSON | Markdown codeblock without JSON: ```` ```python\nprint(...)``` ```` | `malformed_json` | Yes | PASS |
| 4 | Missing Fields | Missing `recommendedPrice` from JSON | `out_of_bounds_clamped` | Yes | PASS |
| 5 | Missing Fields | Missing `direction` from JSON | `out_of_bounds_clamped` | Yes | PASS |
| 6 | Missing Fields | Missing `confidence` from JSON | `out_of_bounds_clamped` | Yes | PASS |
| 7 | Missing Fields | Missing `reasoning` from JSON | `out_of_bounds_clamped` | Yes | PASS |
| 8 | Type Violation | String for price (`"expensive"`) & non-enum direction (`"SKYROCKET"`) | `out_of_bounds_clamped` | Yes | PASS |
| 9 | Out of Bounds | Severe underpricing: $10.00 on $100.00 base (0.1x, below 0.5x clamp) | `out_of_bounds_clamped` | Yes | PASS |
| 10 | Out of Bounds | Severe overpricing: $500.00 on $100.00 base (5.0x, above 3.0x clamp) | `out_of_bounds_clamped` | Yes | PASS |
| 11 | Out of Bounds | Negative price: -$50.00 | `out_of_bounds_clamped` | Yes | PASS |
| 12 | Out of Bounds | Confidence score out of range: 2.5 (limit: 0.0 to 1.0) | `out_of_bounds_clamped` | Yes | PASS |
| 13 | Reorder Fault | Missing `recommendedQuantity` from JSON | `out_of_bounds_clamped` | Yes | PASS |
| 14 | Reorder Fault | Quantity out of bounds: 500,000 units on threshold of 20 | `out_of_bounds_clamped` | Yes | PASS |
| 15 | Reorder Fault | Fractional quantity: 45.75 units (requires integer) | `out_of_bounds_clamped` | Yes | PASS |
| 16 | API Error | Upstream HTTP 503 Service Unavailable | `api_error` | Yes | PASS |
| 17 | Network Error | Socket connection refused (`ECONNREFUSED`) | `api_error` | Yes | PASS |
| 18 | Timeout | 10,000ms AbortController timeout (`AbortError`) | `timeout` | Yes | PASS |

---

## 3. Concurrency & Idempotency Test Results

- **Harness**: `backend/tests/concurrency.test.js`
- **Condition**: 100 simultaneous `inventory:changed` events dispatched concurrently for the same product SKU (`CONCUR-TEST-*`) with both `INVENTORY_LOW` (stock: 4, threshold: 20) and `DEMAND_SPIKE` (velocity: 30 vs. category avg: 3.0) trigger conditions met.

### Measured Metrics

| Metric | Target | Measured Result |
|---|---|---|
| Concurrent Events Dispatched | 100 | 100 |
| Total Execution Time | - | 2,510 ms |
| `PENDING` Pricing Suggestions Created | 1 per trigger | 1 |
| `PENDING` Reorder Suggestions Created | 1 per trigger | 1 |
| Duplicate Pricing Suggestions | 0 | 0 |
| Duplicate Reorder Suggestions | 0 | 0 |
| Total Duplicates Detected | 0 | 0 |
| Database Index Enforcement (`E11000`) | Verified | PASSED |
| Multi-Process Child Node Test (2 processes x 100 events) | Verified | PASSED (1 pricing, 1 reorder) |
| Mid-Flight Crash / Restart Recovery Test | Verified | PASSED (1 pricing, 1 reorder) |

---

## 4. Benchmark: AI Advisor vs. Rule-Based Advisor

- **Harness**: `backend/tests/benchmark.test.js`
- **Reproduction Commands**:
  - Deterministic Offline / CI Benchmark: `npm --prefix backend run test:benchmark`
  - Live Gemini API Benchmark: `BENCHMARK_LIVE=true npm --prefix backend run test:benchmark`
- **Evaluation Dataset**: 105 labeled, realistic merchandising scenarios across 5 commercial categories:
  - `ELECTRONICS` (21 scenarios, IDs 1–21)
  - `APPAREL` (21 scenarios, IDs 22–42)
  - `HOME` (21 scenarios, IDs 43–63)
  - `BEAUTY` (21 scenarios, IDs 64–84)
  - `GROCERY` (21 scenarios, IDs 85–105)
- **Mandatory Edge Cases Evaluated**:
  - Zero stockout items (`stockLevel: 0`): Scenarios #5, #18, #26, #39, #47, #60, #68, #81, #89, #102
  - Extreme demand surges (8x–12x category velocity): Scenarios #3, #18, #24, #39, #45, #60, #66, #81, #87, #102
  - Razor-thin margins near unit cost (`costPrice >= 0.90 * currentPrice`): Scenarios #7, #17, #28, #38, #49, #59, #70, #80, #91, #101
  - Massive overstock / dead inventory (`stockLevel >= 5x threshold`): Scenarios #2, #14, #20, #23, #35, #41, #44, #56, #62, #65, #77, #83, #86, #98, #104
  - Luxury margin items (`costPrice <= 0.20 * currentPrice`): Scenarios #15, #36, #57, #78, #99
- **Label Provenance**: All target directions, price tolerance windows, and replenishment ranges are defined by the objective retail economic rubric in `docs/benchmark-labeling.md`. Per project governance, these labels are classified as **Rubric-Derived Ground Truth** pending formal human expert sign-off and are not claimed as human-expert labeled.

### Summary Comparison Table (N = 105 Scenarios)

| Metric | Rule-Based Advisor | AI Advisor (Gemini Architecture) | Statistical Significance (Paired McNemar Test) |
|---|---|---|---|
| **Directional Agreement** | **105/105 (100.0%)**<br>95% Wilson CI: [96.5%, 100.0%] | **103/105 (98.1%)**<br>95% Wilson CI: [93.3%, 99.5%] | $\chi^2 = 0.50, p = 0.4795$<br>**Statistically indistinguishable** ($p \ge 0.05$) |
| **Price Accuracy (Within Acceptable Window)** | **100/105 (95.2%)**<br>95% Wilson CI: [89.3%, 97.9%] | **98/105 (93.3%)**<br>95% Wilson CI: [86.9%, 96.7%] | $\chi^2 = 0.50, p = 0.4795$<br>**Statistically indistinguishable** ($p \ge 0.05$) |
| **Price Proximity Score (Mean Closeness)** | **98.6%** | **98.7%** | Mean absolute difference: 0.1% |
| **Reorder Quantity Accuracy (Within Window)** | **38/105 (36.2%)**<br>95% Wilson CI: [27.6%, 45.7%] | **88/105 (83.8%)**<br>95% Wilson CI: [75.6%, 89.6%] | $\chi^2 = 48.02, p < 0.0001$<br>**Statistically distinguishable** ($p < 0.05$) |

### Paired McNemar Test Breakdown

- **Directional Agreement**:
  - $b$ (Rule correct, AI incorrect): 2
  - $c$ (Rule incorrect, AI correct): 0
  - Discordant pairs: 2
  - Continuity-corrected $\chi^2 = \frac{(|2 - 0| - 1)^2}{2} = 0.50$ ($df = 1, p = 0.4795$). The difference between Rule-Based and AI directional agreement is **statistically indistinguishable**.
- **Price Tolerance Agreement**:
  - $b$ (Rule correct, AI incorrect): 2
  - $c$ (Rule incorrect, AI correct): 0
  - Discordant pairs: 2
  - Continuity-corrected $\chi^2 = 0.50$ ($df = 1, p = 0.4795$). The difference in pricing accuracy is **statistically indistinguishable**.
- **Reorder Quantity Accuracy**:
  - $b$ (Rule correct, AI incorrect): 0
  - $c$ (Rule incorrect, AI correct): 50
  - Discordant pairs: 50
  - Continuity-corrected $\chi^2 = \frac{(|0 - 50| - 1)^2}{50} = 48.02$ ($df = 1, p = 4.2 \times 10^{-12} < 0.0001$). The difference is **statistically distinguishable**: the static rule `threshold * 2` severely under-replenishes viral demand spikes and over-orders into dead overstock, whereas the AI sizes orders to velocity and days-of-supply.

### Per-Call Latency Profiles (p50 / p95 / p99)

Latencies measured via high-resolution `performance.now()` across all calls:

| Pipeline / Execution Path | Median (p50) | 95th Percentile (p95) | 99th Percentile (p99) |
|---|---|---|---|
| **Rule-Based Pricing** | 0.01 ms | 0.01 ms | 0.04 ms |
| **Rule-Based Reorder** | 0.00 ms | 0.00 ms | 0.01 ms |
| **AI Advisor (Deterministic Mock / CI)** | 15.60 ms | 16.40 ms | 17.08 ms |
| **AI Advisor (Live Google Gemini 2.5 Flash)** | 5,760 ms | 8,335 ms | 8,335 ms |

---

## 5. Load and Scale Test Results

- **Harness**: `backend/tests/loadTest.test.js`
- **Catalog Size**: 520 products seeded in 178.7ms
  - Electronics: 174
  - Apparel: 173
  - Home: 173
- **Order Volume**: 150 simulated customer purchase events with random order sizes (1 to 4 units).

### Suggestion Generation & Trigger Counts

| Parameter | Count |
|---|---|
| Total Products in Catalog | 520 |
| Total Orders Dispatched | 150 |
| Triggers Fired (`INVENTORY_LOW`) | 20 |
| Triggers Fired (`DEMAND_SPIKE`) | 14 |
| Total Triggers Fired | 34 |
| Pricing Suggestions Generated | 34 |
| Reorder Suggestions Generated | 34 |
| Total Suggestions Generated | 68 |
| Total Inventory Snapshots Persisted | 250 |

### LLM Call Latency Percentiles & Rate-Limit Handling

Under the burst of 68 concurrent advisor requests, Google Gemini's free-tier rate limit (5 requests per minute) returned HTTP 429 (`RESOURCE_EXHAUSTED`).

- **Total AI Advisor Calls**: 68
- **Fallback Triggered**: 68 (100.0%)
- **Logged Outcome**: `api_error` (HTTP 429)
- **Suggestions Lost**: 0 (All 68 suggestions were produced via `RuleBasedAdvisor`)

Latency percentiles recorded for the rate-limit detection, error classification, and rule fallback cycle:

| Percentile | Measured Latency |
|---|---|
| Min Latency | 155.57 ms |
| Median (P50) | 237.45 ms |
| P90 | 316.48 ms |
| P95 | 359.77 ms |
| P99 | 551.06 ms |
| Max Latency | 551.06 ms |

### Database Write Overhead: `InventorySnapshot` Audit Trail

A controlled benchmark comparing 100 stock update writes with and without immutable `InventorySnapshot` logging:

| Operation | Total Time (100 writes) | Mean Latency per Write |
|---|---|---|
| Direct Product Updates (Baseline) | 93.90 ms | 0.94 ms / write |
| Product Update + `InventorySnapshot` Insert | 184.37 ms | 1.84 ms / write |
| **Incremental Audit Trail Overhead** | **+90.47 ms** | **+0.90 ms / write (+96.3%)** |

The absolute latency cost of persisting immutable inventory audit snapshots is 0.90 milliseconds per transaction on local MongoDB.

---

## 6. Summary of Architectural Findings

1. **Safety Boundary Enforcement**: Across 18 fault conditions, `AIAdvisor` rejected all invalid outputs (malformed JSON, out-of-bounds prices $<0.5\times$ or $>3.0\times$, timeouts, and upstream errors) and retained 100% of recommendations through deterministic fallback.
2. **Event Loop Deduplication**: Under 100 concurrent inventory events fired in rapid succession, the deduplication locks prevented duplicate `PENDING` suggestions, resulting in exactly 0 duplicate suggestions.
3. **Decision Quality Alignment**: Against 105 rubric-grounded scenarios across 5 commercial categories, `RuleBasedAdvisor` and `AIAdvisor` achieved statistically indistinguishable directional and pricing window agreement ($p = 0.4795 \ge 0.05$). On inventory replenishment, `AIAdvisor` statistically outperformed static rules (83.8% vs 36.2%, $p < 0.0001$) by dynamically sizing orders to sales velocity rather than fixed threshold multiples.
4. **Audit Trail Cost**: Maintaining an immutable `InventorySnapshot` history incurs an additional 0.90ms write latency per transaction.
