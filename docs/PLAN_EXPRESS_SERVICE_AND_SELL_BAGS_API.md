# Plan: Shared Express Service + Sell-all-bags API

**Status:** Plan only — no code changes yet.  
**Goal:** Reuse one Express server for both the autotrader stats listener and a new sell-all-bags API, and run the sell-all path as part of the main subgraph (with storage writes).

---

## 1. Current state

- **AutotraderStatsListenerNode** creates its own Express app, calls `listen(port)` (e.g. 8081), and registers `GET /stats` and `GET /health`. It is a CONTINUOUS node with a **dedicated stats tick loop**; when a request is queued, `onTick()` returns trigger + request_id and the runner runs **executeSubgraphResponseOnly** (read-only subgraph: ClankerAutotraderStats → HttpResponse). The stats listener is **excluded from the main tick** so it doesn’t block on inference.
- **HttpListenerNode** (generic POST listener) also creates its own Express server and uses HttpRequestRegistry + HttpResponse for request/response.
- **Sell-all-bags** today is only a standalone script (`ts/scripts/sell-all-bags.ts`): reads `clanker_bags.json`, sells each holding via cabalSwapper, updates the bags file. No HTTP API.

---

## 2. Desired end state

- **One Express server per port** (e.g. 8081) shared by:
  - **GET /stats** (existing autotrader stats — read-only).
  - **POST /sell-all-bags** (new — write path: sell all bags, update storage).
- **Sell-all-bags request** triggers a subgraph that:
  - Uses the **same** workflow storage/state/wallet as the main autotrader (so it reads/writes the same `clanker_bags.json` and state).
  - Runs **in the main tick** (so it’s “part of the main subgraph” and can safely perform writes and update context).
- Optional later: second storage node for a separate “API” storage instance if we ever need a different data path; for now we use **one storage** (same clanker data) for both scheduler path and sell-all-bags API.

---

## 3. Architecture

### 3.1 Express service node (shared server)

- **New node type:** `express_service`.
- **Role:** Own the Express app and `listen(port)` once. Expose the app so other nodes can register routes (no serialization of `app` in the graph — see below).
- **Inputs (metadata):** `port` (required), optional `host` (default `0.0.0.0`).
- **Lifecycle:**
  - `initialize(workflow, allNodes)`: create Express app, `app.use(express.json())`, CORS if desired, then `this._server = app.listen(port, host)`. Store `this._app` and optionally register in a small **ExpressServiceRegistry** keyed by `(workflowId, nodeId)` or by `port` so listeners can find it.
  - `dispose()`: close the server, remove from registry.
- **How listeners get the app:** Listeners have an optional **connection** from `express_service` (output) → listener (input). The listener’s `initialize(workflow, allNodes)` resolves the connection: if `express_service` is connected, get that node from `allNodes` and call something like `getApp()` on it, then **register routes on that app** instead of creating a new server. So the “connection” is only used to resolve **which node provides the server**; the actual app reference is obtained at init time via `allNodes`.
- **Init order:** The runner must initialize **express_service nodes before any listener** that depends on them. Options:
  - **Two-pass init:** first pass init all nodes with type `express_service`, then second pass init the rest (so stats listener and sell_bags listener get the app when they init).
  - Or: topologically, express_service has no inputs, so it can be initialized first; then listeners that have express_service as input can be initialized and will get the app from the already-initialized node.

### 3.2 Refactor AutotraderStatsListener

- **Optional input:** `express_service` (source node id from connection).
- **Behavior:**
  - If connected to an `express_service` node: in `initialize(workflow, allNodes)`, resolve the express_service node, call `getApp()`, register `GET /health` and `GET /stats` on that app. Do **not** call `listen()` — the express_service already did.
  - If not connected (or no express_service in workflow): keep **current behavior** — create own Express app and `listen(port)` (backward compatible).
- **No change** to how it’s ticked (still has its own stats tick loop) or to executeSubgraphResponseOnly.

### 3.3 Sell-bags listener node (new)

- **New node type:** `sell_bags_listener` (or `sell_all_bags_listener`).
- **Role:** Register **POST /sell-all-bags** (or configurable path) on the shared Express app; queue incoming requests; in **main tick** (not a separate loop), when a request is pending, fire and let the runner run the sell-all subgraph.
- **Input (connection):** Optional `express_service` (same as stats listener — resolve at init to get app and register route).
- **Metadata:** `path` (e.g. `/sell-all-bags`), optional `port` for fallback “create own server” if we want (or always require express_service for this node).
- **Lifecycle:**
  - `initialize(workflow, allNodes)`: if express_service connected, get app and register `POST <path>`. Queue requests (like AutotraderStatsListener). Do **not** start a separate server if we always require express_service.
  - On request: push to `_pending` with requestId, resolve/reject (use same **HttpRequestRegistry** so HttpResponse can send the response).
  - `onTick(context)`: if `_pending.length > 0`, pop one, return `{ trigger: true, request_id, path, method, ... }` so the runner will run the subgraph.
- **Not excluded from main tick:** Unlike the stats listener, this node is **ticked in the main loop** (we do not add it to the “exclude from main tick” list). So when it fires, the runner runs **executeSubgraph** (same as when scheduler fires), which updates context and includes all dependencies and downstream nodes — including write nodes.

### 3.4 Sell-all-bags execution node (new)

- **New node type:** `sell_all_bags` (or re-use name from script).
- **Role:** Implement the “sell all bags” logic that the script does: read bags from storage (via `base_path` / `storage_instance` / `clanker_storage_path`), get wallet and state from inputs, for each holding call sell (reuse existing swap/sell logic from cabalSwapper or ClankerSellNode), update bags file after each sell, return summary (sold count, errors, etc.).
- **Inputs:** `trigger` / `request_id` (from sell_bags_listener), `storage_instance` or `base_path` (same as BagChecker / AddToBags — from MemoryStorage), `state` (blockchain_config), wallet (from Wallet node). Optionally same profit/loss and hook params as ClankerSell.
- **Outputs:** `success`, `sold_count`, `errors` (array), `response_body` (object to send back in HTTP response), and whatever HttpResponse needs (e.g. request_id so it can resolve the pending request).
- **Subgraph wiring:** sell_bags_listener → sell_all_bags (request_id, trigger); MemoryStorage → sell_all_bags (storage_instance / base_path); BlockchainConfig → sell_all_bags (state); Wallet → sell_all_bags; sell_all_bags → HttpResponse (request_id, status, body). So the subgraph clearly includes storage (read+write), wallet, state, and the new node.

### 3.5 Main subgraph and storage

- The sell_bags_listener is **part of the main subgraph** in the sense that:
  - It is an **autonomous node** ticked in the **main tick** (like scheduler, telegram_listener).
  - When it fires, the runner runs **executeSubgraph** (not executeSubgraphResponseOnly), so:
    - Downstream from the listener (sell_all_bags, HttpResponse, etc.) is computed.
    - Dependencies (storage, wallet, state) are included.
    - Downstream-of-subgraph expansion is applied so nothing is missed.
  - The engine then **updates** `context.nodeOutputs` with the results, so any node that wrote to storage (or updated in-memory state) is consistent with the rest of the workflow.
- **Single storage node:** For the default/autotrader workflow we use **one** MemoryStorage node (same clanker data). Both the scheduler-driven path (buy/sell, add_to_bags, update_bags_on_sell) and the sell-all-bags API path use that same storage so they see and update the same bags file. No second storage node unless we later introduce a separate “API-only” workflow with its own storage.

### 3.6 Default workflow (conceptual)

- Add to the **default** workflow (or the clanker-autotrader workflow):
  - **express_service** (e.g. port 8081).
  - **autotrader_stats_listener** with connection from express_service → stats listener (so it registers GET /stats on the shared app).
  - **sell_bags_listener** with connection from express_service → sell_bags_listener; and connections from sell_bags_listener to:
    - **sell_all_bags** node (request_id, etc.),
    - and sell_all_bags gets storage, state, wallet from the same MemoryStorage, BlockchainConfig, Wallet nodes used elsewhere.
  - **HttpResponse** node that receives `request_id` and body from sell_all_bags and calls `HttpRequestRegistry.resolve(requestId, status, body)`.
- Optional: **second storage node** in the same workflow only if we explicitly want a separate storage instance for “API” (e.g. different path). For “sell all bags” we do **not** need a second storage — we want to sell the same bags the autotrader uses.

---

## 4. Implementation order (when we implement)

1. **ExpressServiceNode** — create Express app, listen(port), expose getApp(), registry if needed, dispose.
2. **Runner init order** — ensure express_service nodes are initialized before any node that has a connection from express_service (two-pass or topological).
3. **Refactor AutotraderStatsListener** — optional express_service connection; if present, register routes on shared app and do not listen.
4. **SellBagsListenerNode** — register POST /sell-all-bags on shared app, queue requests, onTick in main loop, use HttpRequestRegistry.
5. **SellAllBagsNode** — read bags, loop sell (reuse cabalSwapper/ClankerSell logic), update bags file, output response body and request_id for HttpResponse.
6. **Wire default (or clanker) workflow** — express_service, both listeners attached, sell_bags_listener → sell_all_bags → HttpResponse; sell_all_bags ← storage, state, wallet.
7. **Tests / manual** — GET /stats still works; POST /sell-all-bags runs subgraph and returns result; bags file is updated.

---

## 5. Summary

- **Same Express service:** One `express_service` node holds the server (port); stats listener and sell_bags listener **attach** to it by registering routes at init (via connection to express_service node).
- **Sell-all-bags is a write path:** It runs in the **main tick** via executeSubgraph (not the read-only stats tick), so it’s part of the “main” subgraph, can use the same storage/state/wallet, and can write to the same bags file.
- **One storage for autotrader + sell-all:** Use a single storage node unless we later add a separate API storage instance on purpose.
- **No code changes in this step** — this document is the plan only; implementation and commit/push will follow when you say to proceed.
