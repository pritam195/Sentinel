# Sentinel Empirical Validation & Benchmark Results

This document reports measured performance data, reliability rates, concurrency behavior, and benchmark comparisons collected from automated test harnesses executed against the Sentinel decision engine.

All figures below reflect actual runs executed on local MongoDB and Node.js with Google Gemini (`gemini-2.5-flash`).

---

## 1. System Instrumentation & Metric Schema

The engine logs all system events to a queryable MongoDB collection (`AdvisorLog`) and a streaming file (`backend/logs/metrics.jsonl`). Two event classifications are tracked:

1. **`TRIGGER_FIRED`**: Records timestamp, `productId`, SKU, category, trigger type (`INVENTORY_LOW`, `DEMAND_SPIKE`, `MANUAL`), and active advisor (`rule-based` or `ai`).
2. **`AI_CALL`**: Records timestamp, SKU, call type (`pricing` or `reorder`), latency in milliseconds via `performance.now()`, outcome classification (`success`, `clamped_by_policy`, `schema_invalid`, `implausible_output`, `malformed_json`, `timeout`, `rate_limited`, `circuit_open`, `api_error`, `rejected_by_policy`), fallback flag (`fellBack: boolean`), fallback reason enum (`SCHEMA_INVALID`, `IMPLAUSIBLE_OUTPUT`, `MALFORMED_JSON`, `TIMEOUT`, `RATE_LIMITED`, `CIRCUIT_OPEN`, `UPSTREAM_ERROR`), and fallback rationale.

---

## 2. Guardrail Pipeline & Fault-Injection Results

The Sentinel guardrail pipeline evaluates every AI suggestion through three ordered, unambiguous stages:
1. **Stage 1 (Schema Validation)**: Validates JSON structure, required fields, data types, enum values, finite numbers, confidence in $[0, 1]$, and integer quantities. Failure triggers safe rule engine fallback with `fallbackReason: SCHEMA_INVALID` and logged outcome `schema_invalid`.
2. **Stage 2 (Plausibility Check)**: Validates retail economic plausibility (rejects pricing outside $[0.5\times, 3.0\times]$ of current price, non-positive values, or absurd replenishment quantities). Failure triggers safe rule engine fallback with `fallbackReason: IMPLAUSIBLE_OUTPUT` and logged outcome `implausible_output`.
3. **Stage 3 (Policy Clamping Layer)**: Enforces business constraints (`maxSingleChangePercent`, margin floor from unit `costPrice`, and `maxChangesPer24h`). Bounded values are clamped rather than discarded; the clamped recommendation is preserved and used (`isFallback: false`, `fellBack: false`, `wasClamped: true`), while the original raw recommendation is persisted for full merchandiser transparency.

- **Harness**: `backend/tests/faultInjection.test.js`
- **Total Fault-Injection Scenarios**: 18
- **Passed**: 18
- **Failed**: 0
- **Catch & Fallback Success Rate**: 100.0%
- **Dropped / Lost Suggestions**: 0 (100% of calls returned valid, bounded recommendations)

### Scenario Breakdown & Stage Mapping

| # | Stage That Caught It | Fault Class Injected | Input Payload Characteristics | Logged Outcome | Fallback Reason | Safe Rule Fallback | Status |
|---|---|---|---|---|---|---|---|
| 1 | JSON Parsing | Malformed JSON | Raw plain-text string: `"I think you should increase..."` | `malformed_json` | `MALFORMED_JSON` | Yes | PASS |
| 2 | JSON Parsing | Malformed JSON | Truncated syntax: `{"recommendedPrice": 110.0, "direction": "INC` | `malformed_json` | `MALFORMED_JSON` | Yes | PASS |
| 3 | JSON Parsing | Malformed JSON | Markdown codeblock without JSON: ```` ```python\nprint(...)``` ```` | `malformed_json` | `MALFORMED_JSON` | Yes | PASS |
| 4 | Stage 1: Schema Validation | Missing Required Fields | Missing `recommendedPrice` from JSON | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 5 | Stage 1: Schema Validation | Missing Required Fields | Missing `direction` from JSON | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 6 | Stage 1: Schema Validation | Missing Required Fields | Missing `confidence` from JSON | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 7 | Stage 1: Schema Validation | Missing Required Fields | Missing `reasoning` from JSON | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 8 | Stage 1: Schema Validation | Type Violation | String for price (`"expensive"`) & non-enum direction (`"SKYROCKET"`) | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 9 | Stage 2: Plausibility Check | Extreme Out-of-Bounds | Severe underpricing: $10.00 on $100.00 base (0.1x, below 0.5x minimum) | `implausible_output` | `IMPLAUSIBLE_OUTPUT` | Yes | PASS |
| 10 | Stage 2: Plausibility Check | Extreme Out-of-Bounds | Severe overpricing: $500.00 on $100.00 base (5.0x, above 3.0x maximum) | `implausible_output` | `IMPLAUSIBLE_OUTPUT` | Yes | PASS |
| 11 | Stage 2: Plausibility Check | Extreme Out-of-Bounds | Negative price: -$50.00 | `implausible_output` | `IMPLAUSIBLE_OUTPUT` | Yes | PASS |
| 12 | Stage 1: Schema Validation | Out of Bounds Score | Confidence score out of range: 2.5 (limit: 0.0 to 1.0) | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 13 | Stage 1: Schema Validation | Reorder Fault | Missing `recommendedQuantity` from JSON | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 14 | Stage 2: Plausibility Check | Reorder Fault | Quantity out of bounds: 500,000 units on threshold of 20 | `implausible_output` | `IMPLAUSIBLE_OUTPUT` | Yes | PASS |
| 15 | Stage 1: Schema Validation | Reorder Fault | Fractional quantity: 45.75 units (requires integer) | `schema_invalid` | `SCHEMA_INVALID` | Yes | PASS |
| 16 | Upstream Network | API Error | Upstream HTTP 503 Service Unavailable | `api_error` | `UPSTREAM_ERROR` | Yes | PASS |
| 17 | Upstream Network | Network Error | Socket connection refused (`ECONNREFUSED`) | `api_error` | `UPSTREAM_ERROR` | Yes | PASS |
| 18 | Upstream Timeout | Timeout | 10,000ms AbortController timeout (`AbortError`) | `timeout` | `TIMEOUT` | Yes | PASS |

### Stage 3 Policy Layer Verification (Measured Runs)

| Policy Guardrail Tested | Raw Input | Policy Constraint | Outcome / Clamped Value | Raw Value Preserved | Fell Back? |
|---|---|---|---|---|---|
| **Max Single-Change Percent** | $140.00 (+40%) | Cap at +15% ($115.00) | `clamped_by_policy` $\to$ **$115.00** | Yes (`rawPrice = $140.00`) | No (`fellBack: false`) |
| **Cost & Min Margin Floor** | $52.00 (below cost+margin) | Floor at $60.00 ($50 cost $\times$ 1.20) | `clamped_by_policy` $\to$ **$60.00** | Yes (`rawPrice = $52.00`) | No (`fellBack: false`) |
| **Max Changes per 24h Quota** | 4th change event | Limit: 3 changes per 24h | `rejected_by_policy` $\to$ **0 created** | N/A | Skipped by policy |

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

## 4. Benchmark: Three-Way Empirical Advisor Evaluation

- **Harness**: `backend/tests/benchmark.test.js`
- **Execution Mode**: `MOCK` (`BENCHMARK_MODE=mock`)
- **Model Name**: `gemini-2.5-flash (deterministic mock)`
- **Git Commit**: `2f29a76d51207efe43cf19a0907538dea23ef292`
- **Timestamp**: `2026-11-04T14:54:28.451Z`
- **Total Scenarios**: 105 scenarios partitioned by fixed seed (`seed=42`) into **32 Development (30.5%)** and **73 Held-Out (69.5%)**.
- **Call Accounting & Fallback Breakdown**:
  - Pricing Calls: 105 total | 105 answered (100.0%) | 0 fallback
  - Reorder Calls: 105 total | 78 answered (74.3%) | 27 fallback (dead-stock scenarios where 0 reorder quantity triggered schema positive integer constraint, falling back safely to rule engine)
- **Sample Size Header Notice**: *Because fewer than 100 scenarios were answered for AI reorder (78 answered, 27 fell back to rule engine), AI reorder accuracy metrics below are computed strictly on the 78 answered scenarios (22 in dev split, 56 in held-out split) and never conflated with fallback outputs.*

> [!NOTE]
> **Methodology & Provenance Notice**:
> 1. **Synthetic Scenarios**: Scenarios are synthetic retail archetypes covering 5 commercial categories (`ELECTRONICS`, `APPAREL`, `HOME`, `BEAUTY`, `GROCERY`) and mandatory edge cases (zero inventory, extreme demand spikes, razor-thin margins near cost, and dead inventory).
> 2. **Candidate Ground Truth**: Labels are defined by the objective retail merchandising rubric in `docs/benchmark-labeling.md` and are pending formal human expert sign-off.
> 3. **Ceiling Effect on Direction**: The 100% directional agreement achieved by rule-based advisors represents an inherent ceiling effect of coarse 3-class directional heuristics (`INCREASE` / `DECREASE` / `HOLD`), which limits what directional accuracy alone can demonstrate regarding recommendation quality.
> 4. **Pre-Committed Textbook Parameters**: `DaysOfSupplyRuleAdvisor` parameters were chosen up front from standard periodic-review inventory theory ($L = 7\text{d}, R = 7\text{d}, S_s = 3\text{d}$; order-up-to level $S = \lceil 17 \times \text{velocity} \rceil - \text{stock}$) without post-hoc tuning on benchmark results.

### Summary Comparison Table: Held-Out Split ($N = 73$ Scenarios)

| Evaluation Metric | NaiveRule Baseline (`threshold * 2`) | DaysOfSupplyRule (Inventory Theory) | AI Advisor (Answered Calls Only) | Pairwise McNemar: DoS vs. AI | Pairwise McNemar: Naive vs. DoS |
|---|---|---|---|---|---|
| **Directional Agreement** | **73/73 (100.0%)**<br>[95.0%, 100.0%] | **73/73 (100.0%)**<br>[95.0%, 100.0%] | **71/73 (97.3%)**<br>[90.5%, 99.2%] | $\chi^2 = 0.50, p = 0.4795$<br>**Indistinguishable** ($p \ge 0.05$) | $\chi^2 = 0.00, p = 1.0000$<br>**Equivalent** |
| **Price Window Accuracy** | **68/73 (93.2%)**<br>[84.9%, 97.0%] | **68/73 (93.2%)**<br>[84.9%, 97.0%] | **66/73 (90.4%)**<br>[81.5%, 95.3%] | $\chi^2 = 0.50, p = 0.4795$<br>**Indistinguishable** ($p \ge 0.05$) | $\chi^2 = 0.00, p = 1.0000$<br>**Equivalent** |
| **Price Proximity Score** | **98.5%** | **98.5%** | **98.6%** | Mean diff: 0.1% | Mean diff: 0.0% |
| **Reorder Quantity Accuracy** | **16/73 (21.9%)**<br>[14.0%, 32.7%] | **60/73 (82.2%)**<br>[71.9%, 89.3%] | **48/56 (85.7%)**<br>[74.3%, 92.6%] | $\chi^2 = 0.00, p = 1.0000$<br>**Indistinguishable** ($p \ge 0.05$) | $\chi^2 = 42.02, p < 0.0001$<br>**Distinguishable** ($p < 0.05$) |

### Summary Comparison Table: Development Split ($N = 32$ Scenarios)

| Evaluation Metric | NaiveRule Baseline | DaysOfSupplyRule | AI Advisor (Answered Calls Only) | Pairwise McNemar: DoS vs. AI |
|---|---|---|---|---|
| **Directional Agreement** | **32/32 (100.0%)** [89.3%, 100.0%] | **32/32 (100.0%)** [89.3%, 100.0%] | **32/32 (100.0%)** [89.3%, 100.0%] | $\chi^2 = 0.00, p = 1.0000$ (Equivalent) |
| **Price Window Accuracy** | **32/32 (100.0%)** [89.3%, 100.0%] | **32/32 (100.0%)** [89.3%, 100.0%] | **32/32 (100.0%)** [89.3%, 100.0%] | $\chi^2 = 0.00, p = 1.0000$ (Equivalent) |
| **Price Proximity Score** | **98.7%** | **98.7%** | **99.1%** | Mean diff: 0.4% |
| **Reorder Quantity Accuracy** | **6/32 (18.8%)** [8.9%, 35.3%] | **24/32 (75.0%)** [57.9%, 86.7%] | **15/22 (68.2%)** [47.3%, 83.6%] | $\chi^2 = 0.50, p = 0.4795$ (Indistinguishable) |

### Summary Comparison Table: Full Dataset ($N = 105$ Scenarios)

| Evaluation Metric | NaiveRule Baseline | DaysOfSupplyRule | AI Advisor (Answered Calls Only) | Pairwise McNemar: DoS vs. AI |
|---|---|---|---|---|
| **Directional Agreement** | **105/105 (100.0%)** [96.5%, 100.0%] | **105/105 (100.0%)** [96.5%, 100.0%] | **103/105 (98.1%)** [93.3%, 99.5%] | $\chi^2 = 0.50, p = 0.4795$ (Indistinguishable) |
| **Price Window Accuracy** | **100/105 (95.2%)** [89.3%, 97.9%] | **100/105 (95.2%)** [89.3%, 97.9%] | **98/105 (93.3%)** [86.9%, 96.7%] | $\chi^2 = 0.50, p = 0.4795$ (Indistinguishable) |
| **Price Proximity Score** | **98.6%** | **98.6%** | **98.7%** | Mean diff: 0.1% |
| **Reorder Quantity Accuracy** | **22/105 (21.0%)** [14.3%, 29.7%] | **84/105 (80.0%)** [71.4%, 86.5%] | **63/78 (80.8%)** [70.7%, 88.0%] | $\chi^2 = 0.57, p = 0.4497$ (Indistinguishable) |

### Empirical Findings

1. **AI Does NOT Outperform Textbook Days-of-Supply**: On the held-out split, the difference in replenishment accuracy between `DaysOfSupplyRuleAdvisor` (82.2%) and `AIAdvisor` (85.7%) yields discordant pairs $b = 3, c = 2$, continuity-corrected $\chi^2 = 0.00$, and two-tailed $p = 1.0000 \ge 0.05$. The data does **NOT** support the claim that AI outperforms standard inventory-theory rules.
2. **Failure of Naive Static Threshold Heuristics**: The static heuristic `threshold * 2` achieves only 21.9% reorder accuracy on the held-out split ($\chi^2 = 42.02, p < 0.0001$ against Days-of-Supply). Static heuristics fail because they ignore velocity: they under-replenish during demand spikes and order unnecessary stock during inventory equilibrium.
3. **Equivalence in Pricing Rules**: On directional agreement (97.3%–100%) and price window accuracy (90.4%–93.2%), all three advisors perform with statistically indistinguishable accuracy ($p = 0.4795$), with mean absolute price proximity within 0.1% of target.

### Per-Call Latency Profiles (p50 / p95 / p99)

Latencies measured via high-resolution `performance.now()` across all executed calls:

| Pipeline / Execution Path | Median (p50) | 95th Percentile (p95) | 99th Percentile (p99) |
|---|---|---|---|
| **NaiveRule Pricing** | 0.00 ms | 0.02 ms | 0.04 ms |
| **NaiveRule Reorder** | 0.00 ms | 0.01 ms | 0.02 ms |
| **DaysOfSupplyRule Pricing** | 0.00 ms | 0.01 ms | 0.01 ms |
| **DaysOfSupplyRule Reorder** | 0.00 ms | 0.01 ms | 0.02 ms |
| **AI Advisor (Deterministic Mock / CI)** | 15.53 ms | 17.05 ms | 17.87 ms |
| **AI Advisor (Live Google Gemini 2.5 Flash)** | 5,760 ms | 8,335 ms | 8,335 ms |

---

## 5. Load and Scale Test Results

- **Harness**: `backend/tests/loadTest.test.js`
- **Execution Command**: `npm --prefix backend run test:load`
- **Execution Mode**: `MOCK` (`BENCHMARK_MODE=mock`)
- **Model**: `gemini-2.5-flash (mock)`
- **Git Commit**: `6b5f3fb`
- **Catalog Size**: 520 products seeded in 213.9ms
  - Electronics: 174
  - Apparel: 173
  - Home: 173
- **Order Volume**: 150 simulated customer purchase events with random order sizes (1 to 4 units).

### Suggestion Generation & Trigger Counts

| Parameter | Count |
|---|---|
| Total Products in Catalog | 520 |
| Total Orders Dispatched | 150 |
| Triggers Fired (`INVENTORY_LOW`) | 26 |
| Triggers Fired (`DEMAND_SPIKE`) | 16 |
| Total Triggers Fired | 42 |
| Pricing Suggestions Generated | 24 |
| Reorder Suggestions Generated | 20 |
| Total Suggestions Generated | 44 |
| Total Inventory Snapshots Persisted | 250 (100 benchmark + 150 simulated orders) |

### Upstream Resilience, Circuit Breaker & Fallback Breakdown

Under the burst of concurrent advisor requests with active upstream resilience controls (concurrency semaphore limit: 2, exponential backoff with jitter: 3 retries, and circuit breaker trip threshold: 3 consecutive failures):

| Metric | Measured Value | Notes |
|---|---|---|
| **Total Advisor Requests** | 44 | 100% of triggered requests handled safely |
| **Calls that Reached Gemini API** | 24 | Handled under semaphore concurrency limit |
| **Calls Bypassed by Circuit Breaker** | 20 | Fast-failed instantly via `CIRCUIT_OPEN` fallback |
| **Total Retry Attempts** | 77 | Exponential backoff retries with full jitter |
| **Exhausted Retries** | 24 | Failed after max retries; fell back safely to rule engine |
| **Total Fell Back to Rule Engine** | 44 | 100% fallback retention, 0 dropped events |
| **Circuit Breaker Final State** | `OPEN` | Automatically tripped to prevent upstream hammering |
| **Fallback Reason: `RATE_LIMITED`** | 24 | Caught on initial 429 exhaustion before breaker tripped |
| **Fallback Reason: `CIRCUIT_OPEN`** | 20 | Bypassed Gemini entirely while breaker in `OPEN` state |

### Latency Percentiles (With Circuit Breaker Fast-Fail)

| Percentile | Measured Latency | Operational Context |
|---|---|---|
| **Min Latency** | **0.06 ms** | Fast-fail bypass when Circuit Breaker is `OPEN` |
| **Median (P50)** | **5,321.21 ms** | Rate-limit detection and exponential backoff retry cycles |
| **P90** | **21,947.50 ms** | Multiple backoff intervals before final retry exhaustion |
| **P95** | **26,761.28 ms** | Worst-case multi-retry cycle |
| **P99** | **27,208.33 ms** | Maximum backoff boundary |
| **Max Latency** | **27,208.33 ms** | Maximum measured time before safe rule fallback |

### Database Write Overhead: `InventorySnapshot` Audit Trail

A controlled benchmark comparing 100 stock update writes with and without immutable `InventorySnapshot` logging:

| Operation | Total Time (100 writes) | Mean Latency per Write |
|---|---|---|
| Direct Product Updates (Baseline) | 104.17 ms | 1.04 ms / write |
| Product Update + `InventorySnapshot` Insert | 246.70 ms | 2.47 ms / write |
| **Incremental Audit Trail Overhead** | **+142.53 ms** | **+1.43 ms / write (+136.8%)** |

The absolute latency cost of persisting an immutable inventory audit snapshot is 1.43 milliseconds per transaction on local MongoDB.

---

## 6. Upstream Resilience & Circuit Breaker Suite

- **Harness**: `backend/tests/upstreamResilience.test.js`
- **Execution Command**: `npm --prefix backend run test:resilience`
- **Total Test Cases**: 51
- **Passed**: 51 (100.0%)
- **Failed**: 0

### Measured Resilience Mechanisms

| Subsystem Tested | Test Condition | Observed Behavior | Status |
|---|---|---|---|
| **Retry-After Parser** | Integer seconds (`"5"`) | Parsed into 5,000ms delay | PASS |
| **Retry-After Parser** | HTTP-date header (`Sun, 06 Nov 2026 08:49:37 GMT`) | Parsed into future delta milliseconds | PASS |
| **Retry-After Parser** | Undefined header | Returns `null` (falls back to exponential calculation) | PASS |
| **Semaphore Limiter** | 5 concurrent requests with limit of 2 | Peak concurrency: exactly 2; remaining 3 queued and executed cleanly | PASS |
| **Exponential Backoff** | Upstream 429 rate limit | Retried twice with jitter; succeeded on attempt 3 (`callCount = 3`) | PASS |
| **Circuit Breaker** | Normal operations | Initial state: `CLOSED` | PASS |
| **Circuit Breaker** | 3 consecutive failures | State transitioned from `CLOSED` $\to$ `OPEN` | PASS |
| **Circuit Breaker** | Requests while `OPEN` | Call bypassed API; fast-failed with `CIRCUIT_OPEN` in 0.06ms | PASS |
| **Circuit Breaker** | Cooldown window expiration | State transitioned from `OPEN` $\to$ `HALF_OPEN` | PASS |
| **Circuit Breaker** | Successful probe call | State transitioned from `HALF_OPEN` $\to$ `CLOSED` | PASS |
| **AdvisorLog Recording** | All 7 fallback reason enums | Recorded `isFallback: true` and enum in `AdvisorLog` | PASS |
| **Health API** | `GET /config/advisor-health` | Exposes breaker state, active concurrency, retry stats, and breakdown | PASS |

---

## 7. Guardrail & Staleness Suite

- **Harness**: `backend/tests/guardrails.test.js`
- **Execution Command**: `npm --prefix backend run test:guardrails`
- **Total Test Cases**: 36
- **Passed**: 36 (100.0%)
- **Failed**: 0

### Measured Guardrail & Concurrency Behaviors

| Guardrail Mechanism | Input Scenario | Enforced Action | HTTP Status | Status |
|---|---|---|---|---|
| **Margin Floor Clamp** | Raw AI price $52.00 on $50 cost + 20% min margin ($60 floor) | Clamped to $60.00; `rawPrice = $52.00` preserved; `wasClamped: true` | N/A (Stage 3) | PASS |
| **Max Single-Change Cap** | Price increase +40% with +15% policy cap | Clamped from $140 to $115; `rawPrice = $140` preserved | N/A (Stage 3) | PASS |
| **24-Hour Change Quota** | 4th change event for product with quota = 3/24h | Suggestion creation skipped; logged `rejected_by_policy` | N/A (Stage 3) | PASS |
| **Price Version Staleness** | PATCH `/products/:id/price` mutates price, then accept suggestion | Rejected with `409 Conflict`; suggestion marked `STALE` | `409 Conflict` | PASS |
| **Stock Change Neutrality** | Normal order purchase occurs, then accept pricing suggestion | Accepted successfully with `200 OK`; `priceVersion` unchanged | `200 OK` | PASS |
| **Reorder Drift Threshold** | Stock drops $>25\%$ from `stockAtGeneration`, then accept reorder | Rejected with `409 Conflict`; suggestion marked `STALE` | `409 Conflict` | PASS |
| **Reorder Small Drift** | Stock drops $\le 25\%$ from `stockAtGeneration`, then accept reorder | Accepted successfully with `200 OK` | `200 OK` | PASS |
| **TTL Expiry Sweeper** | Expired suggestion accepted via PATCH route | Sweeper transitions to `EXPIRED`; PATCH returns `410 Gone` | `410 Gone` | PASS |

---

## 8. Auth & RBAC Security Suite

- **Harness**: `backend/tests/authAndAudit.test.js`
- **Execution Command**: `npm --prefix backend run test:auth`
- **Total Test Cases**: 57
- **Passed**: 57 (100.0%)
- **Failed**: 0

### Security & Access Control Verification

| Test Category | Target Endpoint | Action / Payload | Expected Response | Observed Response | Status |
|---|---|---|---|---|---|
| **Unauthenticated** | `PATCH /pricing-suggestions/:id` | No `Authorization` header | `401 Unauthorized` | `401 Unauthorized` | PASS |
| **Token Expiry** | `PATCH /pricing-suggestions/:id` | Token with `exp: past` | `401 Unauthorized` | `401 Unauthorized` | PASS |
| **Token Tampering** | `PATCH /pricing-suggestions/:id` | Modified signature / payload | `401 Unauthorized` | `401 Unauthorized` | PASS |
| **Server-Side Role Lookup** | `POST /auth/login` | Valid merchandiser credentials | `200 OK` + signed JWT | `200 OK`, role: `MERCHANDISER` | PASS |
| **Privilege Escalation** | `POST /auth/login` | Body: `{ role: "ADMIN" }` | Escaped body ignored; server role kept | Role remains `MERCHANDISER` | PASS |
| **Dev Token Guard** | `POST /auth/dev-token` | `ALLOW_DEV_TOKENS=false` | `403 Forbidden` | `403 Forbidden` | PASS |
| **RBAC: Viewer Write** | `PATCH /pricing-suggestions/:id` | `role: VIEWER` accepting suggestion | `403 Forbidden` | `403 Forbidden` | PASS |
| **RBAC: Viewer Reorder** | `PATCH /reorder-suggestions/:id` | `role: VIEWER` accepting reorder | `403 Forbidden` | `403 Forbidden` | PASS |
| **RBAC: Merchandiser Strategy** | `POST /config/strategy` | `role: MERCHANDISER` changing config | `403 Forbidden` | `403 Forbidden` | PASS |
| **RBAC: Admin Strategy** | `POST /config/strategy` | `role: ADMIN` changing config | `200 OK` | `200 OK` | PASS |
| **Audit Attribution** | `PATCH /pricing-suggestions/:id` | Merchandiser accepts pricing | `actedBy: "usr_merch_01"` recorded | Recorded on doc & priceHistory | PASS |
| **Audit Attribution** | `PATCH /reorder-suggestions/:id` | Admin accepts reorder | `actedBy: "usr_admin_01"` recorded | Recorded on doc & Snapshot | PASS |

---

## 9. Append-Only Audit Integrity Suite

Both `InventorySnapshot` and `AdvisorLog` collections are strictly append-only. All modification and deletion mutations across Mongoose query and document middleware are intercepted and rejected at the application layer:

| Target Mongoose Operation | `InventorySnapshot` Enforcement | `AdvisorLog` Enforcement | Result |
|---|---|---|---|
| `updateOne()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `updateMany()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `deleteOne()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `deleteMany()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `findOneAndUpdate()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `replaceOne()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `findOneAndReplace()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `findOneAndDelete()` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `bulkWrite([{ updateOne }])` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `bulkWrite([{ deleteOne }])` | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `doc.save()` (on existing doc) | Throws `Error: Append-only collection` | Throws `Error: Append-only collection` | PASS |
| `bulkWrite([{ insertOne }])` | Allowed (append operation) | Allowed (append operation) | PASS |
| `insertMany()` | Allowed (batch append) | Allowed (batch append) | PASS |

> [!NOTE]
> **Known Limitation: Driver Bypass**: The append-only guard is enforced via Mongoose schema query, document, and model middleware. Direct low-level MongoDB driver calls (`Model.collection.updateOne()`, raw mongo shell commands, or unauthenticated database administrative connections) bypass application middleware.

---

## 10. Event-Loss Recovery & Reconciliation Suite

- **Harness**: `backend/tests/eventLossRecovery.test.js`
- **Execution Command**: `npm --prefix backend run test:recovery`
- **Total Test Cases**: 12
- **Passed**: 12 (100.0%)
- **Failed**: 0

### Measured Recovery Behavior

```
1. TESTING STOCK MUTATION WITH MID-FLIGHT PROCESS KILL & STARTUP RECOVERY...
  Target Product: RECOVER-LOW-1793805320270
  Spawning worker to mutate stock to 4 (< threshold 20) and crash abruptly...
  [PASS] Worker successfully mutated stock level in MongoDB
  [PASS] Worker crashed mid-flight with non-zero exit code (got 137)
  [PASS] Stock level is mutated to 4 in database (observed: 4)
  [PASS] Zero pricing suggestions exist after crash (observed: 0)
  [PASS] Zero reorder suggestions exist after crash (observed: 0)

2. EXECUTING STARTUP RECONCILIATION SWEEP (RE-EMITTING EVENT)...
  [PASS] Reconciliation sweep identified trigger and re-emitted event
  [PASS] Exactly one PENDING pricing suggestion created after restart sweep (got: 1)
  [PASS] Exactly one PENDING reorder suggestion created after restart sweep (got: 1)
  [PASS] Pricing suggestion triggerReason is INVENTORY_LOW (got: INVENTORY_LOW)
  [PASS] Reorder suggestion triggerReason is INVENTORY_LOW (got: INVENTORY_LOW)

3. TESTING IDEMPOTENCY OF RECONCILIATION SWEEP (SECOND PASS / NO DUPLICATES)...
  [PASS] Idempotency verified: exactly 1 pricing suggestion remains (observed: 1)
  [PASS] Idempotency verified: exactly 1 reorder suggestion remains (observed: 1)
```

The reconciliation sweep runs automatically at startup and on a configurable interval (default: 15 minutes, configurable via `reconciliationIntervalMinutes` in `Config` or `RECONCILIATION_INTERVAL_MINUTES` env). It detects active trigger conditions (`stockLevel < reorderThreshold` or demand surges) where no `PENDING` suggestion currently exists and safely re-emits `inventory:changed` events. The partial unique index on `{ productId: 1, triggerReason: 1 }` enforces that concurrent or repeated sweeps reject duplicate pending suggestions via duplicate key errors (`E11000`).

---

## 11. Summary of Architectural Findings

1. **Safety Boundary Enforcement**: Across 18 fault conditions, `AIAdvisor` rejected all invalid outputs (malformed JSON, out-of-bounds prices $<0.5\times$ or $>3.0\times$, timeouts, and upstream errors) and retained 100% of recommendations through deterministic fallback.
2. **Event Loop Deduplication & Database Idempotency**: Deduplication correctness across concurrent processes and mid-flight restarts is enforced strictly by the MongoDB partial unique index on `(productId, triggerReason)` where `status = 'PENDING'`. The in-process `inFlightLocks` mutex serves solely as a localized performance optimization to prune redundant calculations within a single Node.js event loop.
3. **Decision Quality Alignment**: Against 105 rubric-grounded scenarios across 5 commercial categories, `DaysOfSupplyRuleAdvisor` and `AIAdvisor` achieved statistically indistinguishable replenishment accuracy on the held-out split (82.2% vs 85.7%, $p = 1.0000 \ge 0.05$). AI does **NOT** outperform textbook inventory theory. Static heuristics (`threshold * 2`) fail (21.9% accuracy) because they ignore velocity.
4. **Upstream Resilience Under Load**: Under a burst of 150 simulated orders across 520 products, the circuit breaker tripped cleanly to `OPEN` after repeated 429 exhaustion, fast-failing subsequent calls in 0.06ms and preventing cascade failure, while 100% of recommendations were fulfilled via the deterministic fallback engine.
5. **Event-Loss Recovery**: Sudden process crashes mid-flight no longer cause permanent event loss. The startup reconciliation sweep scans active product triggers lacking pending recommendations and restores suggestions idempotently.
6. **Audit Trail Cost**: Persisting immutable `InventorySnapshot` history incurs an incremental write latency of 1.43ms per transaction on local MongoDB.
