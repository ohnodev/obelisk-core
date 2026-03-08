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
  idempotencyKey: string;
  method: string;
  path: string;
  rawBody: string;
  timestamp: number;
  resolve: (response: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
}

interface InFlightRequest {
  requestId: string;
  idempotencyKey: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface IdempotencyEntry {
  requestId: string;
  status: "processing" | "completed";
  result?: { status: number; body: unknown };
  replayResolvers: Array<(r: { status: number; body: unknown }) => void>;
}

export class LpFillOrderListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _path: string;
  private _app: express.Application | null = null;
  private _pending: QueuedRequest[] = [];
  private _currentRequest: InFlightRequest | null = null;
  private _inFlightByIdempotencyKey = new Map<string, IdempotencyEntry>();

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
      const apiKey = process.env.LP_FILL_ORDER_API_KEY ?? process.env.POLYMARKET_TRADING_API_KEY;
      const allowUnauth =
        process.env.ALLOW_UNAUTHENTICATED_LP_FILL_ORDER === "true" ||
        process.env.ALLOW_UNAUTHENTICATED_LP_FILL_ORDER === "1";
      if (!apiKey && !allowUnauth) {
        res.status(401).json({
          error: "Auth required (LP_FILL_ORDER_API_KEY or ALLOW_UNAUTHENTICATED_LP_FILL_ORDER)",
        });
        return;
      }
      if (apiKey) {
        const key = (req.headers["x-api-key"] as string) ?? (req.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "");
        if (key !== apiKey) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
      }

      const rawBody =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
      let bodyObj: Record<string, unknown> = {};
      try {
        bodyObj = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      } catch (_) {
        /* parse later */
      }
      const idempotencyKey = String(
        (req.headers["idempotency-key"] as string) ?? bodyObj.idempotencyKey ?? bodyObj.idempotency_key ?? ""
      ).trim();
      if (!idempotencyKey) {
        res.status(400).json({
          error: "Missing Idempotency-Key (header or body idempotencyKey)",
        });
        return;
      }

      const existing = this._inFlightByIdempotencyKey.get(idempotencyKey);
      if (existing) {
        if (existing.status === "completed" && existing.result) {
          if (!res.headersSent) res.status(existing.result.status).json(existing.result.body);
          return;
        }
        existing.replayResolvers.push(({ status, body }) => {
          if (!res.headersSent) res.status(status).json(body);
        });
        return;
      }

      if (this._pending.length >= MAX_QUEUE_SIZE) {
        res.status(429).json({ error: "Too many requests", message: "LP fill-order queue full" });
        return;
      }

      const requestId = randomUUID();
      const primaryResolve = ({ status, body }: { status: number; body: unknown }) => {
        if (!res.headersSent) res.status(status).json(body);
      };
      const replayResolvers: Array<(r: { status: number; body: unknown }) => void> = [primaryResolve];
      const wrappedResolve = ({ status, body }: { status: number; body: unknown }) => {
        const entry = this._inFlightByIdempotencyKey.get(idempotencyKey);
        if (entry) {
          entry.status = "completed";
          entry.result = { status, body };
          for (const r of entry.replayResolvers) r({ status, body });
          this._inFlightByIdempotencyKey.delete(idempotencyKey);
        }
      };

      this._inFlightByIdempotencyKey.set(idempotencyKey, {
        requestId,
        status: "processing",
        replayResolvers,
      });

      const queued: QueuedRequest = {
        requestId,
        idempotencyKey,
        method: req.method,
        path: req.path,
        rawBody,
        timestamp: Date.now(),
        resolve: wrappedResolve,
        reject: (err) => {
          const entry = this._inFlightByIdempotencyKey.get(idempotencyKey);
          if (entry) {
            const body = { error: err.message };
            for (const r of entry.replayResolvers) r({ status: 500, body });
            this._inFlightByIdempotencyKey.delete(idempotencyKey);
          } else if (!res.headersSent) {
            res.status(500).json({ error: err.message });
          }
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

      logger.info(`[LpFillOrderListener ${this.nodeId}] Queued POST ${requestId} idempotency=${idempotencyKey}`);
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
    if (this._currentRequest) return null;
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
      if (this._currentRequest?.requestId === q.requestId) {
        this._currentRequest = null;
      }
    }, PROCESSING_TIMEOUT_MS);

    this._currentRequest = { requestId: q.requestId, idempotencyKey: q.idempotencyKey, timeoutId };
    HttpRequestRegistry.registerCleanup(q.requestId, () => {
      clearTimeout(timeoutId);
      if (this._currentRequest?.requestId === q.requestId) {
        this._currentRequest = null;
      }
    });

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

    if (this._currentRequest) {
      clearTimeout(this._currentRequest.timeoutId);
      const entry = this._inFlightByIdempotencyKey.get(this._currentRequest.idempotencyKey);
      if (entry) {
        for (const r of entry.replayResolvers) r({ status: 503, body });
        this._inFlightByIdempotencyKey.delete(this._currentRequest.idempotencyKey);
      }
      HttpRequestRegistry.resolve(this._currentRequest.requestId, 503, body);
      this._currentRequest = null;
    }
    for (const q of this._pending) {
      HttpRequestRegistry.resolve(q.requestId, 503, body);
    }
    this._pending = [];
    this._app = null;
  }
}
