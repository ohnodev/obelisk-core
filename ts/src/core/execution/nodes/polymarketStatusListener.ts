/**
 * PolymarketStatusListenerNode – HTTP listener for polymarket stats (status, trades, PnL).
 * Queues GET requests on /polymarket/stats (and legacy /polymarket/status, /polymarket/trades, /polymarket/pnl),
 * emits request_id via onTick, and lets PolymarketStats + HttpResponse send the response.
 * Uses HttpRequestRegistry. If connected to express_service, registers on shared app.
 *
 * CONTINUOUS node. Outputs: trigger, request_id, path, method.
 */
import express from "express";
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";
import { randomUUID } from "crypto";
import { HttpRequestRegistry } from "./httpListener";
import { getExpressApp } from "./expressService";

const logger = getLogger("polymarketStatusListener");

const MAX_QUEUE_SIZE = 100;

interface QueuedStatsRequest {
  requestId: string;
  method: string;
  path: string;
  query: Record<string, string>;
  timestamp: number;
  resolve: (response: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
}

export class PolymarketStatusListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _port: number;
  private _server: import("http").Server | null = null;
  private _app: express.Application | null = null;
  private _pending: QueuedStatsRequest[] = [];
  private _requestCount = 0;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    const meta = this.metadata;
    const defaultPort = 8081;
    const rawPort = meta.port ?? process.env.POLYMARKET_STATS_PORT ?? defaultPort;
    const numPort = Number(rawPort);
    const valid =
      Number.isFinite(numPort) &&
      Number.isInteger(numPort) &&
      numPort >= 1 &&
      numPort <= 65535;
    this._port = valid ? numPort : defaultPort;
    if (!valid) {
      logger.warn(
        `[PolymarketStatusListener ${nodeId}] Invalid port; using default ${defaultPort}`
      );
    }
  }

  private queueRequest(req: express.Request, res: express.Response): void {
    if (this._pending.length >= MAX_QUEUE_SIZE) {
      res.status(429).json({ error: "Too many requests", message: "Stats queue full" });
      logger.warn(`[PolymarketStatusListener ${this.nodeId}] Rejected GET (queue full)`);
      return;
    }

    const requestId = randomUUID();
    const query = (req.query as Record<string, string>) ?? {};
    const queued: QueuedStatsRequest = {
      requestId,
      method: req.method,
      path: req.path,
      query,
      timestamp: Date.now(),
      resolve: ({ status, body }) => {
        if (!res.headersSent) res.status(status).json(body);
      },
      reject: (err) => {
        if (!res.headersSent) res.status(500).json({ error: err.message });
      },
    };

    HttpRequestRegistry.register({
      requestId,
      message: "",
      userId: "polymarket_stats",
      method: queued.method,
      path: queued.path,
      headers: req.headers as Record<string, string>,
      rawBody: "",
      timestamp: queued.timestamp,
      resolve: queued.resolve,
      reject: queued.reject,
    });
    this._pending.push(queued);

    logger.info(
      `[PolymarketStatusListener ${this.nodeId}] Queued GET ${requestId} ${req.path}`
    );

    setTimeout(() => {
      const idx = this._pending.findIndex((q) => q.requestId === requestId);
      if (idx !== -1) this._pending.splice(idx, 1);
      if (!res.headersSent) {
        HttpRequestRegistry.resolve(requestId, 504, { error: "Stats request timed out" });
      }
    }, 30_000);
  }

  private registerRoutes(app: express.Application): void {
    app.get("/stats", (req, res) => this.queueRequest(req, res)); // alias for Obelisk Service autotrader-stats proxy
    app.get("/polymarket/stats", (req, res) => this.queueRequest(req, res));
    app.get("/polymarket/status", (req, res) => this.queueRequest(req, res));
    app.get("/polymarket/trades", (req, res) => this.queueRequest(req, res));
    app.get("/polymarket/pnl", (req, res) => this.queueRequest(req, res));
    app.get("/health", (_req, res) => {
      res.json({ status: "healthy", node_id: this.nodeId, type: "polymarket_status" });
    });
  }

  override async initialize(
    workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    if (this._server || this._app) {
      logger.warn(`[PolymarketStatusListener ${this.nodeId}] Already initialized`);
      return;
    }

    const workflowId = workflow.id ?? "workflow-1";
    const expressConn = this.inputConnections["express_service"];
    const expressNodeId = expressConn?.[0]?.nodeId;
    const sharedApp = expressNodeId ? getExpressApp(workflowId, expressNodeId) : null;

    if (sharedApp) {
      this._app = sharedApp;
      this.registerRoutes(sharedApp);
      logger.info(
        `[PolymarketStatusListener ${this.nodeId}] Registered /polymarket/* on shared Express`
      );
      return;
    }

    this._app = express();
    this._app.use(express.json({ limit: "64kb" }));
    this._app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      if (_req.method === "OPTIONS") return res.sendStatus(200);
      next();
    });
    this.registerRoutes(this._app);

    return new Promise<void>((resolve, reject) => {
      try {
        this._server = this._app!.listen(this._port, "0.0.0.0", () => {
          logger.info(
            `[PolymarketStatusListener ${this.nodeId}] /polymarket/* listening on 0.0.0.0:${this._port}`
          );
          resolve();
        });
        this._server!.on("error", (err: NodeJS.ErrnoException) => {
          logger.error(`[PolymarketStatusListener ${this.nodeId}] Server error: ${err.message}`);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async execute(_context: ExecutionContext): Promise<Record<string, unknown>> {
    return {
      trigger: false,
      request_id: "",
      path: "",
      method: "",
      query: "{}",
    };
  }

  async onTick(_context: ExecutionContext): Promise<Record<string, unknown> | null> {
    if (!this._pending.length) return null;

    const q = this._pending.shift()!;
    this._requestCount++;

    logger.info(
      `[PolymarketStatusListener ${this.nodeId}] Processing stats request #${this._requestCount} (${q.requestId})`
    );

    return {
      trigger: true,
      request_id: q.requestId,
      path: q.path,
      method: q.method,
      query: JSON.stringify(q.query),
    };
  }

  override dispose(): void {
    const body = { error: "Service Unavailable", message: "Polymarket stats listener shutting down", node_id: this.nodeId };
    for (const q of this._pending) {
      HttpRequestRegistry.resolve(q.requestId, 503, body);
    }
    this._pending = [];

    if (this._server) {
      this._server.close((err) => {
        if (err) logger.warn(`[PolymarketStatusListener ${this.nodeId}] Error closing: ${err.message}`);
      });
      this._server = null;
    }
    this._app = null;
  }
}
