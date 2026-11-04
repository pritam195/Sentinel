# Sentinel UI Screenshot Checklist

This checklist documents the required screenshots for the Sentinel Merchandiser HITL Dashboard. Once captured, save the corresponding PNG files to this directory (`docs/screenshots/`).

---

### 1. `dashboard.png`
- **Component**: Sentinel Merchandiser Dashboard & Catalog Telemetry
- **URL**: `http://localhost:5173/`
- **State to Capture**:
  - Top navigation bar showing current authenticated user (`merchandiser`) and role badge (`MERCHANDISER`).
  - Active advisor pill strip (`Active Strategy: Rule-Based` or `AI Advisor`).
  - Catalog inventory table displaying products with stock levels, category average velocities, and active status tags (`ACTIVE`, `OUT_OF_STOCK`, `PRICE_REVIEW_PENDING`).
  - Quick action buttons to simulate customer purchases (`Buy 1`, `Buy 5`) or adjust stock.

---

### 2. `approval-queue.png`
- **Component**: Human-in-the-Loop (HITL) Suggestion Approval Queue
- **URL**: `http://localhost:5173/` (Approval Queue Tab/Section)
- **State to Capture**:
  - Pending Pricing Suggestions cards:
    - Target SKU, current price, proposed price, directional arrow badge (`INCREASE` / `DECREASE` / `HOLD`).
    - Merchandising rationale text (e.g., *"Inventory is critically low; raising price by 10% to protect remaining stock"*).
    - Confidence score meter (e.g., `60%` or `85%`).
    - Action buttons: `Accept` (green) and `Reject` (red).
  - Pending Reorder Suggestions cards:
    - Current stock vs reorder threshold.
    - Proposed reorder quantity and suggested lead time (days).
    - Action buttons: `Approve Order` and `Dismiss`.

---

### 3. `fallback-badge.png`
- **Component**: Fallback Detection Badge & Telemetry Indicator
- **URL**: `http://localhost:5173/`
- **State to Capture**:
  - The fallback warning pill / badge displayed in the telemetry bar or within a suggestion card.
  - Indicates that an upstream LLM call encountered rate limiting (`RATE_LIMITED` / HTTP 429), circuit breaker skip (`CIRCUIT_OPEN`), or timeout, and was fulfilled through the deterministic rule engine.
  - Displays fallback reason badge (e.g., `FALLBACK: RATE_LIMITED` or `FALLBACK: CIRCUIT_OPEN`) alongside the generated suggestion.

---

### How to Run Locally to Capture
1. Start the stack: `docker compose up -d` (or `npm run seed` && `npm run start` in `backend/` and `npm run dev` in `frontend/`).
2. Run demo scenario: `npm run demo`
3. Log in at `http://localhost:5173` with credentials:
   - **Username**: `merchandiser`
   - **Password**: `merchandiser_dev_password_123`
4. Capture screenshots of each view and save as `dashboard.png`, `approval-queue.png`, and `fallback-badge.png`.
