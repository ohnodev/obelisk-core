/**
 * AutotraderStatsListenerNode – HTTP listener for read-only stats (bags, actions).
 * Listens for GET requests on a path (e.g. /stats), queues them, and triggers the
 * stats subgraph. Uses the same HttpRequestRegistry as HttpListener so HttpResponse
 * can send the response back.
 * If connected to an express_service node, registers routes on the shared app; otherwise starts its own server.
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

const logger = getLogger("autotraderStatsListener");

/** Max number of queued GET /stats requests; excess receive 429. Prevents unbounded memory under load. */
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

export class AutotraderStatsListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _port: number;
  private _path: string;
  private _server: import("http").Server | null = null;
  private _app: express.Application | null = null;
  private _pending: QueuedStatsRequest[] = [];
  private _requestCount = 0;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    const meta = this.metadata;
    const defaultPort = 8081;
    const rawPort = meta.port ?? process.env.AUTOTRADER_STATS_PORT ?? defaultPort;
    const numPort = Number(rawPort);
    const valid =
      Number.isFinite(numPort) &&
      Number.isInteger(numPort) &&
      numPort >= 1 &&
      numPort <= 65535;
    if (valid) {
      this._port = numPort;
    } else {
      this._port = defaultPort;
      logger.warn(
        `[AutotraderStatsListener ${nodeId}] Invalid port (metadata.port=${meta.port}, AUTOTRADER_STATS_PORT=${process.env.AUTOTRADER_STATS_PORT ?? "(unset)"}, raw=${rawPort}); using default ${defaultPort}`
      );
    }
    this._path = String(meta.path ?? "/stats");
    logger.debug(
      `[AutotraderStatsListener ${nodeId}] Initialized: port=${this._port}, path=${this._path}`
    );
  }

  private registerRoutes(app: express.Application): void {
    app.get("/health", (_req, res) => {
      res.json({ status: "healthy", node_id: this.nodeId, port: this._port, type: "autotrader_stats" });
    });

    app.get(this._path, (req, res) => {
      if (this._pending.length >= MAX_QUEUE_SIZE) {
        res.status(429).json({ error: "Too many requests", message: "Stats queue full" });
        logger.warn(`[AutotraderStatsListener ${this.nodeId}] Rejected GET (queue full, size=${this._pending.length})`);
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
        userId: "stats",
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
        `[AutotraderStatsListener ${this.nodeId}] Queued GET ${requestId} ${req.path}`
      );

      setTimeout(() => {
        const idx = this._pending.findIndex((q) => q.requestId === requestId);
        if (idx !== -1) this._pending.splice(idx, 1);
        if (!res.headersSent) {
          HttpRequestRegistry.resolve(requestId, 504, { error: "Stats request timed out" });
        }
      }, 30_000);
    });
  }

  override async initialize(
    workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    if (this._server || this._app) {
      logger.warn(`[AutotraderStatsListener ${this.nodeId}] Already initialized`);
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
        `[AutotraderStatsListener ${this.nodeId}] Registered GET ${this._path} on shared Express (port from express_service)`
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
            `[AutotraderStatsListener ${this.nodeId}] GET ${this._path} listening on 0.0.0.0:${this._port}`
          );
          resolve();
        });
        this._server!.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            logger.error(`[AutotraderStatsListener ${this.nodeId}] Port ${this._port} already in use`);
          } else {
            logger.error(`[AutotraderStatsListener ${this.nodeId}] Server error: ${err.message}`);
          }
          reject(err);
        });
      } catch (err) {
        logger.error(`[AutotraderStatsListener ${this.nodeId}] Failed to start server: ${err}`);
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
      `[AutotraderStatsListener ${this.nodeId}] Processing stats request #${this._requestCount} (${q.requestId})`
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
    const body = { error: "Service Unavailable", message: "Stats listener shutting down", node_id: this.nodeId };
    for (const q of this._pending) {
      HttpRequestRegistry.resolve(q.requestId, 503, body);
    }
    this._pending = [];

    if (this._server) {
      this._server.close((err) => {
        if (err) logger.warn(`[AutotraderStatsListener ${this.nodeId}] Error closing server: ${err.message}`);
        else logger.info(`[AutotraderStatsListener ${this.nodeId}] Server closed on port ${this._port}`);
      });
      this._server = null;
    }
    this._app = null;
  }
}
