/**
 * HttpListenerNode – autonomous node that starts an HTTP server and queues
 * incoming POST requests so the downstream graph can process each one.
 *
 * This is a CONTINUOUS node. The WorkflowRunner calls onTick() every ~100ms;
 * when a request has been received and queued, it emits the message one-per-tick
 * so each request gets its own full downstream graph execution.
 *
 * The HTTP response is sent back via the companion HttpResponseNode, which
 * resolves the pending request through a shared static registry.
 *
 * Inputs:  (none – autonomous listener)
 * Outputs:
 *   trigger:     boolean – true when a request is being processed
 *   message:     string  – the request body text / JSON stringified
 *   user_id:     string  – extracted from body.user_id or "anonymous"
 *   request_id:  string  – unique ID for correlating with HttpResponseNode
 *   method:      string  – HTTP method (POST, GET, etc.)
 *   path:        string  – request path (e.g. /api/chat)
 *   headers:     string  – JSON-stringified request headers
 *   raw_body:    string  – raw request body as string
 */
import express from "express";
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";
import { randomUUID } from "crypto";

const logger = getLogger("httpListener");

interface QueuedRequest {
  requestId: string;
  message: string;
  userId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  rawBody: string;
  timestamp: number;
  resolve: (response: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
}

/**
 * Shared registry for pending HTTP requests.
 * HttpResponseNode uses this to send a response back to the waiting client.
 */
export class HttpRequestRegistry {
  private static pendingRequests = new Map<string, QueuedRequest>();

  static register(req: QueuedRequest): void {
    this.pendingRequests.set(req.requestId, req);
  }

  static resolve(requestId: string, status: number, body: unknown): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;
    req.resolve({ status, body });
    this.pendingRequests.delete(requestId);
    return true;
  }

  static reject(requestId: string, error: Error): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;
    req.reject(error);
    this.pendingRequests.delete(requestId);
    return true;
  }

  /** Auto-timeout requests that have been waiting too long. */
  static cleanup(maxAgeMs = 30_000): void {
    const now = Date.now();
    for (const [id, req] of this.pendingRequests) {
      if (now - req.timestamp > maxAgeMs) {
        req.resolve({ status: 504, body: { error: "Request timed out" } });
        this.pendingRequests.delete(id);
      }
    }
  }
}

export class HttpListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _port: number;
  private _path: string;
  private _server: import("http").Server | null = null;
  private _app: express.Application | null = null;
  private _pendingMessages: QueuedRequest[] = [];
  private _messageCount = 0;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);

    const meta = this.metadata;
    this._port = Number(meta.port ?? process.env.HTTP_LISTENER_PORT ?? 8080);
    this._path = String(meta.path ?? "/api/chat");

    logger.debug(
      `[HttpListener ${nodeId}] Initialized: port=${this._port}, path=${this._path}`
    );
  }

  override async initialize(
    _workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    if (this._server) {
      logger.warn(`[HttpListener ${this.nodeId}] Server already running`);
      return;
    }

    this._app = express();
    this._app.use(express.json({ limit: "1mb" }));
    this._app.use(express.text({ limit: "1mb" }));

    // CORS headers for broad access
    this._app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (_req.method === "OPTIONS") {
        return res.sendStatus(200);
      }
      next();
    });

    // Health check endpoint
    this._app.get("/health", (_req, res) => {
      res.json({ status: "healthy", node_id: this.nodeId, port: this._port });
    });

    // Main request handler
    this._app.post(this._path, (req, res) => {
      const requestId = randomUUID();
      const body = req.body;

      // Compute rawBody first so it's always a safe string
      const rawBody =
        typeof body === "string" ? body : (JSON.stringify(body) ?? "");

      // Extract message: prefer body.message, fall back to body.text, then rawBody
      let message: string;
      if (typeof body === "string") {
        message = body;
      } else if (body?.message) {
        message = String(body.message);
      } else if (body?.text) {
        message = String(body.text);
      } else {
        message = rawBody;
      }

      const userId = String(body?.user_id ?? body?.userId ?? "anonymous");

      const queued: QueuedRequest = {
        requestId,
        message,
        userId,
        method: req.method,
        path: req.path,
        headers: req.headers as Record<string, string>,
        rawBody,
        timestamp: Date.now(),
        resolve: ({ status, body: respBody }) => {
          if (!res.headersSent) {
            res.status(status).json(respBody);
          }
        },
        reject: (error) => {
          if (!res.headersSent) {
            res.status(500).json({ error: error.message });
          }
        },
      };

      HttpRequestRegistry.register(queued);
      this._pendingMessages.push(queued);

      logger.info(
        `[HttpListener ${this.nodeId}] Queued request ${requestId} from ${userId}: ${message.slice(0, 80)}`
      );

      // Set a timeout — if HttpResponseNode doesn't respond within 30s, auto-resolve
      setTimeout(() => {
        if (!res.headersSent) {
          HttpRequestRegistry.resolve(requestId, 504, {
            error: "Processing timed out",
          });
        }
      }, 30_000);
    });

    // Start the server
    return new Promise<void>((resolve, reject) => {
      try {
        this._server = this._app!.listen(this._port, "0.0.0.0", () => {
          logger.info(
            `[HttpListener ${this.nodeId}] HTTP server listening on 0.0.0.0:${this._port}${this._path}`
          );
          resolve();
        });
        this._server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            logger.error(
              `[HttpListener ${this.nodeId}] Port ${this._port} already in use`
            );
          } else {
            logger.error(
              `[HttpListener ${this.nodeId}] Server error: ${err.message}`
            );
          }
          reject(err);
        });
      } catch (err) {
        logger.error(
          `[HttpListener ${this.nodeId}] Failed to start server: ${err}`
        );
        reject(err);
      }
    });
  }

  async execute(
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    return {
      trigger: false,
      message: "",
      user_id: "",
      request_id: "",
      method: "",
      path: "",
      headers: "{}",
      raw_body: "",
    };
  }

  async onTick(
    _context: ExecutionContext
  ): Promise<Record<string, unknown> | null> {
    // Clean up stale requests periodically
    HttpRequestRegistry.cleanup(30_000);

    // Emit one queued request per tick
    if (!this._pendingMessages.length) return null;

    const queued = this._pendingMessages.shift()!;
    this._messageCount++;

    logger.info(
      `[HttpListener ${this.nodeId}] Processing request #${this._messageCount} ` +
        `(${queued.requestId}) from ${queued.userId}: ${queued.message.slice(0, 50)}...`
    );

    return {
      trigger: true,
      message: queued.message,
      user_id: queued.userId,
      request_id: queued.requestId,
      method: queued.method,
      path: queued.path,
      headers: JSON.stringify(queued.headers),
      raw_body: queued.rawBody,
    };
  }

  override dispose(): void {
    // Resolve all pending requests with 503 before closing so clients don't hang
    const unavailableBody = {
      error: "Service Unavailable",
      message: "Listener shutting down",
      node_id: this.nodeId,
    };
    for (const queued of this._pendingMessages) {
      HttpRequestRegistry.resolve(queued.requestId, 503, unavailableBody);
    }
    this._pendingMessages = [];

    if (this._server) {
      this._server.close((err) => {
        if (err) {
          logger.warn(
            `[HttpListener ${this.nodeId}] Error closing server: ${err.message}`
          );
        } else {
          logger.info(
            `[HttpListener ${this.nodeId}] HTTP server closed on port ${this._port}`
          );
        }
      });
      this._server = null;
      this._app = null;
    }
  }
}
