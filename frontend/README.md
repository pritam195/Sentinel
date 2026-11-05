# Sentinel Decision Desk (Frontend)

**A high-velocity, keyboard-first Human-in-the-Loop merchandising interface for autonomous commerce engines.**

Built on React 19, Vite, Tailwind CSS, TanStack Table, and Lucide React. Designed around the operational thesis:
> *"AI should be fast to propose, but slow to trust."*

---

## Visual Architecture: "Decision Desk — Mission Control"

Sentinel replaces generic dashboard spreadsheets with a focused triage workstation modeled after tools like Linear and Superhuman:

- **Review Queue (Triage Desk)**: Split inbox with age/confidence filters, before/after hero comparisons, guardrail audit logs, and one-key approvals (`A` to accept, `R` to reject, `J`/`K` to navigate).
- **Catalog Desk**: Dense, virtualized TanStack Table with real-time stock-to-threshold health ratio bars, labeled inventory steppers, and purchase simulation controls.
- **Advisor Health Telemetry**: Live three-state Circuit Breaker visual (`CLOSED`, `HALF_OPEN`, `OPEN`), Semaphore concurrency gauge, retry stats, and audited fallback accounting.
- **Live Reasoning Inspector**: Sliding SSE token terminal streaming real-time Gemini 2.5 Flash reasoning with pause-on-scroll and syntax formatting.
- **Command Palette (`⌘K` / `Ctrl+K`)**: Instant search and navigation across SKUs, actions, role switching, and view jumping.

---

## Screenshot & Visual Layout

```
+-----------------------------------------------------------------------------------------+
| [⌘K Search...]     [CPU: GEMINI ADVISOR]   [Breaker: CLOSED]   (Bell)  (Theme)  (User)  |
+---------+-----------------------------------+-------------------------------------------+
| (Inbox) | REVIEW QUEUE (Pending: 8)         | PROPOSAL INSPECTION PANE                  |
| Review  | [SKU-ELEC-001] Earbuds Pro        | SKU-ELEC-001 — Wireless Earbuds Pro       |
|         |   $79.99 -> $87.99 (+10.0%)       |                                           |
| (Grid)  |   [LOW STOCK] [RULE ENGINE]       | Retail Price: $79.99 -> $87.99 (+10.0%)   |
| Catalog |                                   | Projected Margin: 54.5% GM                |
|         | [SKU-APP-001] Cotton T-Shirt      |                                           |
| (Pulse) |   Stock 8 -> +40 units            | [Stage 3 Guardrails Cleared Cleanly]      |
| Health  |   [DEMAND SPIKE] [GEMINI ADVISOR] | Economic Rationale:                       |
|         |                                   | Stock critically low (8 < 15 threshold).  |
|         | [SKU-HOME-002] LED Lamp           | Restocking to maintain safety buffer.     |
|         |   Stock 0 -> +30 units            |                                           |
|         |   [OUT OF STOCK] [CLAMPED]        | [A: Accept Proposal]  [R: Reject]         |
+---------+-----------------------------------+-------------------------------------------+
| Advisor suggestions are proposals; a human approves every change.     v2.1.0 (React 19) |
+-----------------------------------------------------------------------------------------+
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `J` / `K` | Select next / previous proposal in review inbox |
| `A` | Accept currently selected proposal (prompts confirmation) |
| `R` | Reject currently selected proposal |
| `/` | Focus search filter in current view |
| `⌘K` / `Ctrl+K` | Open global Command Palette |
| `?` | Show keyboard shortcuts guide |
| `Esc` | Close open modal, drawer, or command palette |

---

## Development & Production Build

### Environment Variables

Configure `.env` in the `frontend` root (or root `.env`):

```bash
VITE_API_URL=http://localhost:5000
```

### Running Locally

```bash
# Install dependencies
npm install

# Start Vite development server (port 5173)
npm run dev

# Production build & bundle analysis
npm run build
```

---

## Features Skipped ("Needs Backend Work")

In accordance with Ground Rule 3 (*never invent data, endpoints, or metrics*), the following UI features were identified as desirable but omitted because existing backend endpoints do not return the necessary telemetry:

1. **Category Gross Margin Rollup**: The UI displays unit margin where `costPrice` is present, but an aggregated category-level profitability overview requires a backend aggregation route (e.g. `GET /metrics/margin-by-category`).
2. **Paginated Historical Audit Log Viewer**: While `InventorySnapshot` and `AdvisorLog` collections are strictly append-only in MongoDB, the API lacks a dedicated paginated endpoint for non-admin audit inspection (e.g. `GET /audit-logs?page=1`).
3. **Supplier Lead Time Database**: Reorder proposals show `suggestedLeadTimeDays`, but dynamic supplier SLA tracking requires a `Supplier` collection in MongoDB.
