# Sentinel Empirical Validation & Benchmark Results

This document reports measured performance data, reliability rates, concurrency behavior, and benchmark comparisons collected from automated test harnesses executed against the Sentinel decision engine.

All figures below reflect actual runs executed on local MongoDB and Node.js v22.14.0 with Google Gemini 3.6 Flash (`gemini-3.6-flash`).

---

## 1. System Instrumentation & Metric Schema

The engine logs all system events to a queryable MongoDB collection (`AdvisorLog`) and a streaming file (`backend/logs/metrics.jsonl`). Two event classifications are tracked:

1. **`TRIGGER_FIRED`**: Records timestamp, `productId`, SKU, category, trigger type (`INVENTORY_LOW`, `DEMAND_SPIKE`, `MANUAL`), and active advisor (`rule-based` or `ai`).
2. **`AI_CALL`**: Records timestamp, SKU, call type (`pricing` or `reorder`), latency in milliseconds via `performance.now()`, outcome classification (`success`, `timeout`, `malformed_json`, `out_of_bounds_clamped`, `api_error`), fallback flag (`fellBack: boolean`), and fallback rationale.

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
| Total Execution Time | - | 3,012 ms |
| `PENDING` Pricing Suggestions Created | 1 per trigger | 1 |
| `PENDING` Reorder Suggestions Created | 1 per trigger | 1 |
| Duplicate Pricing Suggestions | 0 | 0 |
| Duplicate Reorder Suggestions | 0 | 0 |
| Total Duplicates Detected | 0 | 0 |
| ADR 5 Idempotency Status | Verified | PASSED |

---

## 4. Benchmark: AI Advisor vs. Rule-Based Advisor

- **Harness**: `backend/tests/benchmark.test.js`
- **Evaluation Dataset**: 25 labeled, realistic merchandising scenarios across ELECTRONICS (8), APPAREL (8), and HOME (9).
- **Ground Truth**: Each scenario contains expert human judgment defining expected price direction (`INCREASE`, `DECREASE`, `HOLD`), an acceptable price tolerance range, an expected price midpoint, an acceptable reorder range, and operational rationale.

### Summary Comparison Table

| Metric | Rule-Based Advisor | AI Advisor (Gemini 3.6 Flash) |
|---|---|---|
| **Directional Agreement** | 25/25 (100.0%) | 24/25 (96.0%) |
| **Price Accuracy (Within Acceptable Window)** | 25/25 (100.0%) | 24/25 (96.0%) |
| **Price Proximity Score (Mean Closeness)** | 99.6% | 97.4% |
| **Reorder Quantity Accuracy (Within Window)** | 20/25 (80.0%) | 18/25 (72.0%) |

### Granular Scenario Results

| ID | Category | Scenario Name | Expert Expected | Rule-Based Output | AI Advisor Output | Status |
|---|---|---|---|---|---|---|
| 01 | ELEC | Wireless ANC Headphones | INCREASE $219.99 | INCREASE $219.99 | INCREASE $239.99 | Both Within Window |
| 02 | ELEC | Braided 100W USB-C Cable (Excess Stock) | HOLD $19.99 | HOLD $19.99 | DECREASE $14.99 | AI Disagreed (Clearance Discount) |
| 03 | ELEC | Multi-Port GaN Wall Charger (Surge) | INCREASE $52.99 | INCREASE $52.49 | INCREASE $54.99 | Both Within Window |
| 04 | ELEC | Mechanical Gaming Keyboard (Low Stock) | INCREASE $142.99 | INCREASE $142.99 | INCREASE $139.99 | Both Within Window |
| 05 | ELEC | Smart 4K Action Camera (Out of Stock) | INCREASE $274.99 | INCREASE $274.99 | INCREASE $274.99 | Both Within Window |
| 06 | ELEC | Portable Bluetooth Speaker (Equilibrium) | HOLD $69.99 | HOLD $69.99 | HOLD $69.99 | Both Within Window |
| 07 | ELEC | Wireless Mouse (10% Margin Pressure) | INCREASE $27.49 | INCREASE $27.49 | INCREASE $27.49 | Both Within Window |
| 08 | ELEC | 10,000mAh Slim Power Bank (Surge) | INCREASE $41.99 | INCREASE $41.99 | INCREASE $41.99 | Both Within Window |
| 09 | APPAREL | Heavyweight Pullover Hoodie (Winter Surge) | INCREASE $68.25 | INCREASE $71.50 | INCREASE $71.50 | Both Within Window |
| 10 | APPAREL | Organic Crewneck T-Shirt (Critical Low) | INCREASE $30.80 | INCREASE $30.80 | INCREASE $30.80 | Both Within Window |
| 11 | APPAREL | Performance Running Shorts (Stagnant) | HOLD $42.00 | HOLD $42.00 | HOLD $42.00 | Both Within Window |
| 12 | APPAREL | Waterproof Trail Jacket (Balanced) | HOLD $119.00 | HOLD $119.00 | HOLD $119.00 | Both Within Window |
| 13 | APPAREL | Thermal Merino Wool Socks (Low Stock) | INCREASE $24.20 | INCREASE $24.20 | INCREASE $24.20 | Both Within Window |
| 14 | APPAREL | Fleece-Lined Beanie (Moderate Surge) | INCREASE $27.30 | INCREASE $27.30 | INCREASE $27.30 | Both Within Window |
| 15 | APPAREL | Linen Casual Shirt (72% Margin Luxury) | INCREASE $97.90 | INCREASE $97.90 | INCREASE $97.90 | Both Within Window |
| 16 | APPAREL | Athletic Ankle Socks (Staple Equilibrium) | HOLD $18.00 | HOLD $18.00 | HOLD $18.00 | Both Within Window |
| 17 | HOME | Ceramic Pour-Over Maker (Surge + Low) | INCREASE $47.25 | INCREASE $49.50 | INCREASE $49.50 | Both Within Window |
| 18 | HOME | Aroma Diffuser Ultrasonic (Low Stock) | INCREASE $39.60 | INCREASE $39.60 | INCREASE $39.60 | Both Within Window |
| 19 | HOME | Cast Iron Skillet 10-Inch (Excess Stock) | HOLD $49.99 | HOLD $49.99 | HOLD $49.99 | Both Within Window |
| 20 | HOME | Minimalist LED Desk Lamp (1 Unit Left) | INCREASE $63.80 | INCREASE $63.80 | INCREASE $63.80 | Both Within Window |
| 21 | HOME | Stainless Steel Insulated Tumbler (Spike) | INCREASE $31.49 | INCREASE $31.49 | INCREASE $31.49 | Both Within Window |
| 22 | HOME | Cotton Linen Throw Pillow (Equilibrium) | HOLD $32.00 | HOLD $32.00 | HOLD $32.00 | Both Within Window |
| 23 | HOME | Double-Walled Espresso Glasses (Low) | INCREASE $26.40 | INCREASE $26.40 | INCREASE $28.00 | Both Within Window |
| 24 | HOME | Bamboo Cutting Board (15% Margin) | INCREASE $21.99 | INCREASE $21.99 | INCREASE $22.99 | Both Within Window |
| 25 | HOME | Scented Soy Candle (Demand Spike) | INCREASE $23.63 | INCREASE $23.63 | INCREASE $24.75 | Both Within Window |

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
3. **Decision Quality Alignment**: Against 25 ground-truth expert scenarios, the deterministic `RuleBasedAdvisor` showed 100% directional agreement, while `AIAdvisor` achieved 96.0% directional agreement (the single divergence being a clearance discount recommendation on overstock).
4. **Audit Trail Cost**: Maintaining an immutable `InventorySnapshot` history incurs an additional 0.90ms write latency per transaction.
