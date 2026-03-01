/**
 * PolymarketStatusListenerNode – HTTP routes for polymarket status, trades, PnL.
 * Registers on express_service. Reads from polymarket_trades.json and returns JSON.
 * CONTINUOUS node. Does not queue; responds directly from file read.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";
import { getExpressApp } from "./expressService";

const logger = getLogger("polymarketStatusListener");

function getTradesPath(): string {
  const base =
    process.env.POLYMARKET_STORAGE_PATH?.trim() ||
    path.join(process.cwd(), "data", "polymarket");
  return path.join(base, "polymarket_trades.json");
}

function readTrades(): unknown[] {
  const p = getTradesPath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data?.trades ?? []);
  } catch {
    return [];
  }
}

function computePnl(trades: unknown[]): { grossPnl: number; winCount: number; lossCount: number } {
  let grossPnl = 0;
  let winCount = 0;
  let lossCount = 0;
  for (const t of trades) {
    const rec = t as Record<string, unknown>;
    const outcome = String(rec.outcome ?? "").toLowerCase();
    const pnl = Number(rec.pnl ?? rec.pnlUsd ?? 0);
    if (outcome === "won" || outcome === "win") {
      winCount++;
      grossPnl += pnl;
    } else if (outcome === "lost" || outcome === "loss") {
      lossCount++;
      grossPnl += pnl;
    }
  }
  return { grossPnl, winCount, lossCount };
}

export class PolymarketStatusListenerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _server: import("http").Server | null = null;
  private _app: express.Application | null = null;

  private registerRoutes(app: express.Application): void {
    app.get("/polymarket/status", (_req, res) => {
      const trades = readTrades();
      res.json({
        running: true,
        trade_count: trades.length,
        node_id: this.nodeId,
      });
    });

    app.get("/polymarket/trades", (_req, res) => {
      const trades = readTrades();
      res.json({ trades });
    });

    app.get("/polymarket/pnl", (_req, res) => {
      const trades = readTrades();
      const { grossPnl, winCount, lossCount } = computePnl(trades);
      res.json({
        grossPnl,
        winCount,
        lossCount,
        lastUpdated: trades.length > 0 ? (trades[trades.length - 1] as Record<string, unknown>).ts : null,
      });
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

    const defaultPort = 8082;
    const rawPort = this.metadata.port ?? process.env.POLYMARKET_STATS_PORT ?? defaultPort;
    const port = Math.max(1, Math.min(65535, Number(rawPort) || defaultPort));

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
        this._server = this._app!.listen(port, "0.0.0.0", () => {
          logger.info(
            `[PolymarketStatusListener ${this.nodeId}] /polymarket/* listening on 0.0.0.0:${port}`
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
    return { trigger: false };
  }

  override dispose(): void {
    if (this._server) {
      this._server.close((err) => {
        if (err) logger.warn(`[PolymarketStatusListener ${this.nodeId}] Error closing: ${err.message}`);
      });
      this._server = null;
    }
    this._app = null;
  }
}
