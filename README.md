# Sentinel

**An event-driven inventory and dynamic pricing engine that treats AI as advisory, not authoritative.**

Sentinel is a full-stack commerce decision system that autonomously detects inventory and demand signals, generates pricing and replenishment recommendations using either deterministic rules or a Google Gemini 2.5 Flash LLM advisor, and routes every suggestion through an authenticated human-in-the-loop (HITL) approval queue before it can affect live pricing or stock.

---

## Thesis: "AI should be fast to propose, but slow to trust."

Most autonomous pricing and inventory tools force a choice between rigid manual spreadsheets and opaque AI systems that can make unbounded, uninspected decisions. Sentinel is built around a different operational premise: **AI-generated commerce decisions should be fast to propose, but slow to trust.**

1. **Fast to propose**: When stock dips or demand surges, the engine evaluates catalog telemetry within milliseconds (rule path: $\le 0.01\text{ ms}$) or seconds (LLM path: $\sim 5.7\text{ s}$), drafting reasoned proposals.
2. **Slow to trust**: Suggestions are strictly advisory. Every recommendation is bounded by margin floors, rate clamps, and schema validators. Suggestions enter a `PENDING` queue protected by optimistic concurrency and RBAC. Mutating live prices or issuing purchase orders requires explicit review by an authorized merchandiser or admin. If the LLM times out, errors, or hits rate limits, the suggestion pipeline falls back to deterministic rule-based logic (preserving recommendation generation for that trigger). For process restarts or mid-flight worker crashes where an in-memory event was lost before completion, a reconciliation sweep scans MongoDB at boot and on a configurable interval (default: 15 minutes) to re-emit events for active trigger conditions lacking pending suggestions. Note that the reconciliation sweep covers persistent inventory states (e.g., stock below threshold or sustained demand surges) where trigger criteria still evaluate to true; transient point-in-time velocity spikes that have already decayed in memory before database persistence or reconciliation are not recoverable without an external persistent event log.

---

## Architecture

```mermaid
graph TD
    subgraph Client["React 19 + Vite Dashboard"]
        UI["Merchandiser HITL Queue"]
        Ticker["Telemetry & Health Pill Strip"]
        Stream["Live Reasoning Inspector (SSE)"]
        FallbackBanner["Fallback Detection Badge"]
    end

    subgraph API["Express 5 API & Auth Boundary"]
        AuthMid["JWT Auth & RBAC (Viewer, Merchandiser, Admin)"]
        RoutesAuth["/auth/login, /auth/dev-token, /auth/me"]
        RoutesProd["/products"]
        RoutesSugg["/pricing-suggestions, /reorder-suggestions"]
        RoutesConfig["/config/strategy, /config/advisor-health"]
        SSEStream["/suggest-pricing/stream (SSE)"]
    end

    subgraph Core["Event-Driven Core & Guardrails"]
        EventEmitter["In-Process EventEmitter"]
        AgentLoop["Recommendation Loop"]
        DedupeLocks["MongoDB Partial Unique Index (inFlightLocks optimization)"]
        Guardrails["3-Stage Validation Pipeline (Schema, Plausibility, Policy)"]
        TTLWorker["Suggestion TTL Expiration Sweeper"]
        Reconcile["Startup & Periodic Reconciliation Sweeper"]
    end

    subgraph Engines["Advisors & Upstream Resilience"]
        Registry["Strategy Registry"]
        RuleAdvisor["NaiveRule / DaysOfSupplyRule"]
        AIAdvisor["AIAdvisor (Gemini 2.5 Flash)"]
        Resilience["Semaphore (5) + Circuit Breaker + Backoff / Retry-After"]
    end

    subgraph Storage["MongoDB (Application-Enforced Append-Only Audit)"]
        DB_Prod[("Products, Price History & priceVersion")]
        DB_Sugg[("Pending / Accepted / Rejected / Stale Suggestions")]
        DB_Snap[("InventorySnapshots (actedBy)")]
        DB_Logs[("AdvisorLogs (fallbackReason enum)")]
    end

    UI --> RoutesAuth
    UI --> RoutesProd
    UI --> RoutesSugg
    UI --> RoutesConfig
    UI --> SSEStream
    RoutesProd -- "inventory:changed" --> EventEmitter
    Reconcile -- "re-emits active triggers" --> EventEmitter
    EventEmitter --> AgentLoop
    AgentLoop --> DedupeLocks
    DedupeLocks --> Guardrails
    Guardrails --> Registry
    Registry -.-> RuleAdvisor
    Registry -.-> AIAdvisor
    AIAdvisor --> Resilience
    Resilience -. "on 429/timeout/circuit open" .-> RuleAdvisor
    AgentLoop --> DB_Sugg
    AIAdvisor --> DB_Logs
    RoutesSugg --> DB_Prod
    RoutesSugg --> DB_Snap
```

---

## Core Guardrails & System Defenses

| Defense Layer | Mechanism | Protection Scope |
|---|---|---|
| **Upstream Resilience** | Concurrency Semaphore (max 5 in-flight), Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`), Exponential Backoff with Jitter | Mitigates cascading failures during Gemini API throttling or 429 rate limits |
| **Idempotency & Deduplication** | MongoDB partial unique index on `(productId, triggerReason)` where `status = "PENDING"` (with an in-process `inFlightLocks` mutex optimization) | Deduplication correctness is enforced strictly at the database layer via partial unique index (`E11000`). The in-memory mutex is an in-process compute optimization; multi-process and restart correctness relies entirely on MongoDB. |
| **Margin & Price Floors** | Floor clamp: $\max(\text{costPrice} \times (1 + \text{minMargin}), \; 0.5 \times \text{currentPrice})$ | Prevents negative gross margin sales and predatory underpricing |
| **Volatility Clamps** | Configurable `maxSingleChangePercent` (default 20%) and `maxChangesPer24h` (default 5 changes / SKU / 24h) | Inhibits rapid price oscillations and automated runaway repricing |
| **Optimistic Concurrency & Staleness** | Pricing suggestions track `priceVersion` (bumping on price/cost changes); Reorder suggestions track `stockAtGeneration` with drift threshold ($\le 25\%$) | Rejects with **409 Conflict** and marks suggestion `STALE` if priceVersion changed or stock drifted $>25\%$. Normal purchases do not invalidate pricing suggestions. |
| **TTL Auto-Expiration** | Configurable `expiresAt` (default 24h) with automatic background sweeper | Moves unacted suggestions to `EXPIRED` (rejects with **410 Gone** if attempted) |
| **RBAC & Audit Trail** | JWT Auth: `VIEWER` (read-only), `MERCHANDISER` (accept/reject), `ADMIN` (config strategy). Stamped acting user ID on all mutations | Server-side role enforcement on login; tracks `actedBy` on suggestions, snapshots, and `changedBy` on price history |
| **Append-Only Integrity** | Mongoose query, document, and model hooks intercept all 11 modification and deletion methods on audit collections | Protects `InventorySnapshot` and `AdvisorLog` against application-level modification or deletion |
| **Event-Loss Recovery** | Startup & periodic reconciliation sweep (default 15m interval) scanning MongoDB for active triggers lacking pending suggestions | Automatically re-emits `inventory:changed` events after unexpected process crashes or restarts |

---

## Tech Stack

- **Backend:** Node.js 20+, Express 5, MongoDB + Mongoose, Google Gemini 2.5 Flash (`gemini-2.5-flash`), `jsonwebtoken`
- **Frontend:** React 19, Vite, custom CSS design system with fallback detection banners
- **Testing:** Fault-injection battery, multi-process concurrency harness, upstream resilience test, guardrail test, auth & audit test, 105-scenario benchmark

---

## Measured Empirical Results

All performance figures, reliability rates, and benchmark comparisons are measured from actual test runs executed on local MongoDB and Node.js with Gemini 2.5 Flash. Full data and reproduction commands in [`RESULTS.md`](./RESULTS.md).

### 1. Safety & Resilience Metrics

| Test Suite | Scope & Condition | Measured Result |
|---|---|---|
| **Fault Injection** | 18 fault conditions (malformed JSON, extreme out-of-bounds prices $<0.5\times$ or $>3.0\times$, timeouts, socket errors) | **18/18 (100.0%) safe fallback, 0 lost suggestions** |
| **Multi-Process Concurrency** | 2 child Node processes firing 100 simultaneous events each at the same SKU | **0 duplicate suggestions** (exact 1 pricing and 1 reorder suggestion created) |
| **Mid-Flight Crash & Restart Recovery** | Stock mutation followed by abrupt worker termination (code 137); startup reconciliation sweep executes | **0 duplicate suggestions** (clean crash recovery via DB partial index and startup sweep) |
| **Upstream Throttling / 429 Burst** | 520 products, 150 customer orders; 44 advisor requests (24 reached Gemini, 20 bypassed by Circuit Breaker) | **44/44 suggestions retained** via circuit-breaker and rule fallback |

### 2. 105-Scenario Merchandising Benchmark Summary

Evaluated across 105 scenarios partitioned into **32 development (30.5%)** and **73 held-out (69.5%)** by a fixed deterministic seed (`seed=42`). Results compare three distinct advisors:
1. **NaiveRule**: Static threshold-based baseline ($\text{reorder quantity} = \max(0, 2 \times \text{threshold} - \text{stock})$).
2. **DaysOfSupplyRule**: Standard periodic-review inventory control theory ($L=7\text{d}, R=7\text{d}, S_s=3\text{d}$ buffer; order-up-to level $S = \lceil 17 \times \text{velocity} \rceil - \text{stock}$).
3. **AI Advisor**: LLM architecture evaluated strictly on answered scenarios (mock mode: `gemini-2.5-flash (mock)`; git commit `6b5f3fb`).

> [!NOTE]
> **Methodology & Provenance Notice**:
> - Scenarios are synthetic retail merchandising archetypes.
> - Ground truth labels are derived from the retail economic rubric in `docs/benchmark-labeling.md` and are pending human expert sign-off.
> - The 100% directional agreement score represents a ceiling effect inherent in coarse 3-class directional heuristics (`INCREASE` / `DECREASE` / `HOLD`), which limits what directional agreement alone can reveal about pricing quality.
> - **Empirical Finding**: On the held-out split, the AI Advisor does **NOT** outperform the textbook `DaysOfSupplyRule` advisor ($\chi^2 = 0.00, p = 1.0000 \ge 0.05$). Rather, both inventory theory and AI substantially outperform the naive static rule on replenishment sizing because they dynamically factor demand velocity into protection periods.

#### Held-Out Split Performance ($N = 73$ Scenarios)

| Evaluation Metric | NaiveRule Baseline | DaysOfSupplyRule (Inventory Theory) | AI Advisor (Answered Calls) | Pairwise McNemar Test (DoS vs. AI) |
|---|---|---|---|---|
| **Directional Agreement** | **73/73 (100.0%)**<br>[95.0%, 100.0%] | **73/73 (100.0%)**<br>[95.0%, 100.0%] | **71/73 (97.3%)**<br>[90.5%, 99.2%] | $\chi^2 = 0.50, p = 0.4795$<br>**Statistically indistinguishable** ($p \ge 0.05$) |
| **Price Accuracy (Acceptable Window)** | **68/73 (93.2%)**<br>[84.9%, 97.0%] | **68/73 (93.2%)**<br>[84.9%, 97.0%] | **66/73 (90.4%)**<br>[81.5%, 95.3%] | $\chi^2 = 0.50, p = 0.4795$<br>**Statistically indistinguishable** ($p \ge 0.05$) |
| **Mean Price Proximity** | **98.5%** | **98.5%** | **98.6%** | Mean absolute difference: 0.1% |
| **Reorder Quantity Accuracy** | **16/73 (21.9%)**<br>[14.0%, 32.7%] | **60/73 (82.2%)**<br>[71.9%, 89.3%] | **48/56 (85.7%)**\*<br>[74.3%, 92.6%] | $\chi^2 = 0.00, p = 1.0000$<br>**Statistically indistinguishable** ($p \ge 0.05$) |

*\*Header Note: For AI reorder, 56 scenarios were answered and 17 fell back on dead stock under the integer schema constraint.*

#### Development Split Performance ($N = 32$ Scenarios)
- **Directional Agreement**: NaiveRule 32/32 (100%), DaysOfSupply 32/32 (100%), AIAdvisor 32/32 (100%)
- **Price Accuracy**: NaiveRule 32/32 (100%), DaysOfSupply 32/32 (100%), AIAdvisor 32/32 (100%)
- **Reorder Quantity Accuracy**: NaiveRule 6/32 (18.8%), DaysOfSupply 24/32 (75.0%), AIAdvisor 15/22 (68.2%) (DoS vs AI $\chi^2 = 0.50, p = 0.4795$)

### 3. Per-Call Latency Profile

Measured via high-resolution `performance.now()`:
- **Rule-Based Engine**: Pricing $\text{p50} = 0.01\text{ ms}$, $\text{p95} = 0.01\text{ ms}$, $\text{p99} = 0.03\text{ ms}$; Reorder $\text{p50} = 0.00\text{ ms}$.
- **Live Gemini 2.5 Flash**: Pricing $\text{p50} = 5,760\text{ ms}$, $\text{p95} = 8,335\text{ ms}$; Reorder $\text{p50} = 5,502\text{ ms}$, $\text{p95} = 5,912\text{ ms}$.

Rule-based decisions evaluate in sub-millisecond time, whereas live LLM calls require 5–8 seconds over the network ($\approx 500,000\times$ slower), supporting Sentinel's architecture of decoupled, asynchronous suggestion generation with deterministic fallback.

---

## Known Limitations

1. **In-Process EventEmitter & Event-Loss Scope**: Event dispatching relies on Node.js's in-process `EventEmitter`. Events currently queued in memory are lost if the Node process experiences a sudden crash before execution. The startup and periodic reconciliation sweep recovers persistent catalog trigger conditions (`stockLevel < reorderThreshold` or sustained demand surges) lacking pending suggestions, but cannot reconstruct unpersisted transient telemetry. Production multi-node scaling requires a persistent distributed message broker (e.g., Redis Streams, RabbitMQ, or Apache Kafka).
2. **Single-Region Scope**: Database partial unique indexes and optimistic concurrency version checks (`priceVersion`, `stockAtGeneration`) enforce correctness across multi-process workers on a shared MongoDB database, but multi-region active-active deployments with cross-datacenter replication lag are not currently addressed.
3. **Application-Level vs Database-Enforced Append-Only**: The append-only behavior of `InventorySnapshot` and `AdvisorLog` is enforced in application code via Mongoose model, query, and document middleware hooks (`updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete`, `deleteOne`, `deleteMany`, `bulkWrite`, and `save` on existing documents). Direct calls via `Model.collection.*`, raw MongoDB drivers, or administrative shell sessions bypass these application-level hooks. Database-level immutability requires configuring custom MongoDB roles (e.g., `readWrite` without `update` or `delete` privileges) on the production database user.
4. **Synthetic Benchmark Scenarios & Ceiling Effects**: The 105 benchmark scenarios are synthetically constructed commercial archetypes across 5 retail categories. The 100% directional accuracy on coarse 3-class actions (`INCREASE`, `DECREASE`, `HOLD`) reflects an empirical ceiling effect that does not capture complex, long-tail real-world demand elasticity.
5. **Benchmark Label Provenance & Sign-off**: Benchmark candidate ground truth labels are derived programmatically from the retail merchandising rubric in `docs/benchmark-labeling.md`. Until formal expert review and sign-off is completed via the signature block in that document, labels represent rubric-grounded candidate ground truth rather than verified expert human labels.

---

## API Reference

All write endpoints require a valid JWT bearer token (`Authorization: Bearer <token>`).

| Method | Endpoint | Required Role | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticate seeded user (`{ username, password }`) -> returns JWT & server role |
| `POST` | `/auth/dev-token` | Public (dev only) | Mint development token when `ALLOW_DEV_TOKENS=true` |
| `GET` | `/auth/me` | Authenticated | Inspect current authenticated user and role |
| `GET` | `/products` | Public / Viewer | List catalog items (`?status=&category=`) |
| `PATCH` | `/products/:id/stock` | Merchandiser, Admin | Adjust inventory (`{ stockLevel }` or `{ delta }`) |
| `PATCH` | `/products/:id/price` | Merchandiser, Admin | Adjust price / costPrice (`{ currentPrice, costPrice }`) & bump `priceVersion` |
| `POST` | `/products/:id/orders` | Public / Viewer | Simulate a purchase |
| `POST` | `/products/:id/suggest-pricing` | Merchandiser, Admin | Trigger pricing advice on demand |
| `POST` | `/products/:id/suggest-pricing/stream` | Merchandiser, Admin | Stream live Gemini reasoning via SSE |
| `POST` | `/products/:id/suggest-reorder` | Merchandiser, Admin | Trigger replenishment advice on demand |
| `GET` | `/pricing-suggestions` | Public / Viewer | Fetch pricing suggestions (`?status=`) |
| `PATCH` | `/pricing-suggestions/:id` | Merchandiser, Admin | Accept or reject pricing suggestion (enforces optimistic concurrency) |
| `GET` | `/reorder-suggestions` | Public / Viewer | Fetch reorder suggestions (`?status=`) |
| `PATCH` | `/reorder-suggestions/:id` | Merchandiser, Admin | Accept or reject reorder suggestion |
| `GET` | `/config/strategy` | Public / Viewer | View active advisor strategy |
| `PATCH` | `/config/strategy` | Admin | Change active advisor (`rule-based` or `ai`) |
| `GET` | `/config/advisor-health` | Public / Viewer | View circuit breaker state and fallback counters |

---

## Getting Started

### Prerequisites
- Node.js 20+
- MongoDB running locally (`mongodb://localhost:27017`)
- Gemini API key (optional — system operates via deterministic rule-based advisor if absent)

### Backend Setup
```bash
cd backend
cp .env.example .env      # Add MONGO_URI and optional LLM_API_KEY
npm install
node seed.js               # Seed catalog and initial snapshots
npm run dev                # Starts API server on http://localhost:5000
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev                # Starts Vite dev server on http://localhost:5173
```

### Running Test Suites
```bash
cd backend
npm test                   # Run core test suites (fault, concurrency, resilience, guardrails, auth, recovery)
npm run test:fault         # 18-case fault-injection battery
npm run test:concurrency   # In-process, multi-process (2x100), and mid-flight restart tests
npm run test:resilience    # Upstream semaphore, backoff, and circuit breaker tests
npm run test:guardrails    # Margin floors, 24h limits, optimistic concurrency, and TTL tests
npm run test:auth          # JWT authentication, RBAC, and append-only hook tests
npm run test:recovery      # Mid-flight crash and startup reconciliation recovery test
npm run test:benchmark     # 105-scenario rule vs. AI evaluation with Wilson CIs & McNemar test
npm run test:load          # 520-product scale test with 150 simulated order events
npm run test:all           # Complete automated test battery
```

---

## License

MIT
