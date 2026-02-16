/**
 * SellBagsListenerNode – HTTP listener for POST /sell-all-bags.
 * Queues requests and fires in the main tick so the runner runs executeSubgraph (write path).
 * If connected to express_service, registers on the shared app; otherwise requires express_service.
 */
import express from "express";
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";
import { randomUUID } from "crypto";
import { HttpRequestRegistry } from "./httpListener";
import { getExpressApp } from "./expressService";

const logger = getLogger("sellBagsListener");

const MAX_QUEUE_SIZE = 10;

interface QueuedRequest {
  requestId: string;
  method: string;
  path: string;
  timestamp: number;
  resolve: (response: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
}

export class SellBagsListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _path: string;
  private _app: express.Application | null = null;
  private _pending: QueuedRequest[] = [];

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    this._path = String(this.metadata.path ?? "/sell-all-bags");
    logger.debug(`[SellBagsListener ${nodeId}] Initialized: path=${this._path}`);
  }

  override async initialize(
    workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    if (this._app) {
      logger.warn(`[SellBagsListener ${this.nodeId}] Already initialized`);
      return;
    }

    const workflowId = workflow.id ?? "workflow-1";
    const expressConn = this.inputConnections["express_service"];
    const expressNodeId = expressConn?.[0]?.nodeId;
    const sharedApp = expressNodeId ? getExpressApp(workflowId, expressNodeId) : null;

    if (!sharedApp) {
      logger.warn(`[SellBagsListener ${this.nodeId}] No express_service connected — register this node with an Express Service node (same port as stats)`);
      return;
    }

    this._app = sharedApp;
    this._app.post(this._path, (req, res) => {
      if (this._pending.length >= MAX_QUEUE_SIZE) {
        res.status(429).json({ error: "Too many requests", message: "Sell-all-bags queue full" });
        return;
      }

      const requestId = randomUUID();
      const queued: QueuedRequest = {
        requestId,
        method: req.method,
        path: req.path,
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
        userId: "sell-bags",
        method: queued.method,
        path: queued.path,
        headers: req.headers as Record<string, string>,
        rawBody: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
        timestamp: queued.timestamp,
        resolve: queued.resolve,
        reject: queued.reject,
      });
      this._pending.push(queued);

      logger.info(`[SellBagsListener ${this.nodeId}] Queued POST ${requestId} ${req.path}`);

      setTimeout(() => {
        const idx = this._pending.findIndex((q) => q.requestId === requestId);
        if (idx !== -1) this._pending.splice(idx, 1);
        if (!res.headersSent) {
          HttpRequestRegistry.resolve(requestId, 504, { error: "Sell-all-bags request timed out" });
        }
      }, 120_000);
    });

    logger.info(`[SellBagsListener ${this.nodeId}] POST ${this._path} registered on shared Express`);
  }

  async execute(_context: ExecutionContext): Promise<Record<string, unknown>> {
    return {
      trigger: false,
      request_id: "",
      path: "",
      method: "",
    };
  }

  async onTick(_context: ExecutionContext): Promise<Record<string, unknown> | null> {
    if (!this._pending.length) return null;

    const q = this._pending.shift()!;
    logger.info(`[SellBagsListener ${this.nodeId}] Processing sell-all-bags request ${q.requestId}`);

    return {
      trigger: true,
      request_id: q.requestId,
      path: q.path,
      method: q.method,
    };
  }

  override dispose(): void {
    const body = { error: "Service Unavailable", message: "Sell-bags listener shutting down", node_id: this.nodeId };
    for (const q of this._pending) {
      HttpRequestRegistry.resolve(q.requestId, 503, body);
    }
    this._pending = [];
    this._app = null;
  }
}
