/**
 * ExpressServiceNode – provider node: shared Express server (one per port).
 * Does not read workflow state or trigger execution; only provides the app.
 * Listeners (autotrader_stats_listener, sell_bags_listener) connect to this node
 * and register their routes on the same app. Read-only (e.g. /stats) and write
 * (e.g. /sell-all-bags) paths are separate subgraphs; they just share the server.
 */
import express from "express";
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("expressService");

export type ExpressApp = express.Application;

/** Registry so listeners can get the app by (workflowId, nodeId) when they init after express_service. */
const appByKey = new Map<string, ExpressApp>();

export function getExpressApp(workflowId: string, nodeId: string): ExpressApp | null {
  return appByKey.get(`${workflowId}:${nodeId}`) ?? null;
}

export function setExpressApp(workflowId: string, nodeId: string, app: ExpressApp): void {
  appByKey.set(`${workflowId}:${nodeId}`, app);
}

export function clearExpressApp(workflowId: string, nodeId: string): void {
  appByKey.delete(`${workflowId}:${nodeId}`);
}

export class ExpressServiceNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _port: number;
  private _host: string;
  private _server: import("http").Server | null = null;
  private _app: express.Application | null = null;
  private _workflowId: string | null = null;

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
    this._port = valid ? numPort : defaultPort;
    this._host = String(meta.host ?? "0.0.0.0").trim() || "0.0.0.0";
    logger.debug(
      `[ExpressService ${nodeId}] Initialized: port=${this._port}, host=${this._host}`
    );
  }

  getApp(): express.Application | null {
    return this._app;
  }

  override async initialize(
    workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    if (this._server) {
      logger.warn(`[ExpressService ${this.nodeId}] Server already running`);
      return;
    }

    this._workflowId = workflow.id ?? "workflow-1";

    this._app = express();
    this._app.use(express.json({ limit: "64kb" }));

    this._app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      if (_req.method === "OPTIONS") return res.sendStatus(200);
      next();
    });

    setExpressApp(this._workflowId, this.nodeId, this._app);

    return new Promise<void>((resolve, reject) => {
      try {
        this._server = this._app!.listen(this._port, this._host, () => {
          logger.info(
            `[ExpressService ${this.nodeId}] Listening on ${this._host}:${this._port}`
          );
          resolve();
        });
        this._server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            logger.error(`[ExpressService ${this.nodeId}] Port ${this._port} already in use`);
          } else {
            logger.error(`[ExpressService ${this.nodeId}] Server error: ${err.message}`);
          }
          clearExpressApp(this._workflowId!, this.nodeId);
          reject(err);
        });
      } catch (err) {
        logger.error(`[ExpressService ${this.nodeId}] Failed to start server: ${err}`);
        clearExpressApp(this._workflowId!, this.nodeId);
        reject(err);
      }
    });
  }

  async execute(_context: ExecutionContext): Promise<Record<string, unknown>> {
    return { ready: !!this._app, port: this._port };
  }

  override dispose(): void {
    if (this._workflowId) clearExpressApp(this._workflowId, this.nodeId);
    this._workflowId = null;
    if (this._server) {
      this._server.close((err) => {
        if (err) logger.warn(`[ExpressService ${this.nodeId}] Error closing server: ${err.message}`);
        else logger.info(`[ExpressService ${this.nodeId}] Server closed on port ${this._port}`);
      });
      this._server = null;
      this._app = null;
    }
  }
}
