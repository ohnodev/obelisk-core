/**
 * LpFillOrderListenerNode – HTTP listener for POST /lp/fill-order (cross-chain LP fill path).
 * Queues requests and emits trigger + request_id + raw_body for downstream PolymarketLpFillOrderNode.
 * Registers on the shared Express app from express_service (same pattern as sell_bags_listener).
 */
import express from "express";
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";
import { randomUUID } from "crypto";
import { HttpRequestRegistry } from "./httpListener";
import { getExpressApp } from "./expressService";

const logger = getLogger("lpFillOrderListener");

const MAX_QUEUE_SIZE = 10;

const PROCESSING_TIMEOUT_MS = 30_000;

interface QueuedRequest {
  requestId: string;
  method: string;
  path: string;
  rawBody: string;
  timestamp: number;
  resolve: (response: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
}

export class LpFillOrderListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _path: string;
  private _app: express.Application | null = null;
  private _pending: QueuedRequest[] = [];

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    const raw = this.metadata.path ?? "/lp/fill-order";
    const resolved = this.resolveEnvVar(raw);
    this._path = String(resolved ?? raw).trim() || "/lp/fill-order";
    logger.debug(`[LpFillOrderListener ${nodeId}] Initialized: path=${this._path}`);
  }

  override async initialize(
    workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    if (this._app) {
      logger.warn(`[LpFillOrderListener ${this.nodeId}] Already initialized`);
      return;
    }

    const workflowId = workflow.id ?? "workflow-1";
    const expressConn = this.inputConnections["express_service"];
    const expressNodeId = expressConn?.[0]?.nodeId;
    const sharedApp = expressNodeId ? getExpressApp(workflowId, expressNodeId) : null;

    if (!sharedApp) {
      logger.warn(
        `[LpFillOrderListener ${this.nodeId}] No express_service connected — register this node with an Express Service node`
      );
      return;
    }

    this._app = sharedApp;
    this._app.post(this._path, (req, res) => {
      if (this._pending.length >= MAX_QUEUE_SIZE) {
        res.status(429).json({ error: "Too many requests", message: "LP fill-order queue full" });
        return;
      }

      const requestId = randomUUID();
      const rawBody =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

      const queued: QueuedRequest = {
        requestId,
        method: req.method,
        path: req.path,
        rawBody,
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
        message: rawBody,
        userId: "lp-fill-order",
        method: queued.method,
        path: queued.path,
        headers: req.headers as Record<string, string>,
        rawBody: queued.rawBody,
        timestamp: queued.timestamp,
        resolve: queued.resolve,
        reject: queued.reject,
      });
      this._pending.push(queued);

      logger.info(`[LpFillOrderListener ${this.nodeId}] Queued POST ${requestId} ${req.path}`);
    });

    logger.info(
      `[LpFillOrderListener ${this.nodeId}] POST ${this._path} registered on shared Express`
    );
  }

  async execute(_context: ExecutionContext): Promise<Record<string, unknown>> {
    return {
      trigger: false,
      request_id: "",
      raw_body: "",
      path: "",
      method: "",
    };
  }

  async onTick(_context: ExecutionContext): Promise<Record<string, unknown> | null> {
    if (!this._pending.length) return null;

    const q = this._pending.shift()!;
    logger.info(`[LpFillOrderListener ${this.nodeId}] Processing fill-order request ${q.requestId}`);

    const timeoutId = setTimeout(() => {
      const resolved = HttpRequestRegistry.resolve(q.requestId, 504, {
        error: "LP fill-order request timed out",
      });
      if (resolved) {
        logger.warn(`[LpFillOrderListener ${this.nodeId}] Request ${q.requestId} timed out after ${PROCESSING_TIMEOUT_MS}ms`);
      }
    }, PROCESSING_TIMEOUT_MS);
    HttpRequestRegistry.registerCleanup(q.requestId, () => clearTimeout(timeoutId));

    return {
      trigger: true,
      request_id: q.requestId,
      raw_body: q.rawBody,
      path: q.path,
      method: q.method,
    };
  }

  override dispose(): void {
    const body = {
      error: "Service Unavailable",
      message: "LP fill-order listener shutting down",
      node_id: this.nodeId,
    };
    for (const q of this._pending) {
      HttpRequestRegistry.resolve(q.requestId, 503, body);
    }
    this._pending = [];
    this._app = null;
  }
}
