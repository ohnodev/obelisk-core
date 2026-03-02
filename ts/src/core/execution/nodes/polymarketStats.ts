/**
 * PolymarketStatsNode – reads polymarket_trades.json from storage, formats status/trades/pnl
 * for HTTP response. Inputs: request_id, storage_instance.
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";

const logger = getLogger("polymarketStats");

const TRADES_FILE = "polymarket_trades.json";
const ACTIONS_FILE = "polymarket_actions.json";

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

export class PolymarketStatsNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const requestId = (this.getInputValue("request_id", context, "") as string) ?? "";
    const storageInstance = this.getInputValue("storage_instance", context, undefined) as Record<string, unknown> | undefined;
    const basePath = storageInstance?.basePath && typeof storageInstance.basePath === "string"
      ? String(storageInstance.basePath).trim()
      : path.join(process.cwd(), "data", "polymarket");
    const tradesPath = path.join(path.resolve(basePath), TRADES_FILE);

    let trades: unknown[] = [];
    if (fs.existsSync(tradesPath)) {
      try {
        const raw = fs.readFileSync(tradesPath, "utf-8");
        const data = JSON.parse(raw);
        trades = Array.isArray(data) ? data : (data?.trades ?? []);
      } catch (e) {
        logger.warn(`[PolymarketStats] Failed to read ${abbrevPathForLog(tradesPath)}: ${e}`);
      }
    }

    const { grossPnl, winCount, lossCount } = computePnl(trades);
    const lastTrade = trades.length > 0 ? (trades[trades.length - 1] as Record<string, unknown>) : null;

    let actions: unknown[] = [];
    const actionsPath = path.join(path.dirname(tradesPath), ACTIONS_FILE);
    if (fs.existsSync(actionsPath)) {
      try {
        const raw = fs.readFileSync(actionsPath, "utf-8");
        const data = JSON.parse(raw);
        actions = Array.isArray(data) ? data : (data?.actions ?? []);
      } catch (err) {
        logger.error(`[PolymarketStats] Failed to read/parse polymarket_actions.json: ${err}`);
      }
    }
    const lastActions = actions.slice(-100);

    const body = {
      running: true,
      trade_count: trades.length,
      trades,
      lastActions,
      pnl: {
        grossPnl,
        winCount,
        lossCount,
        lastUpdated: lastTrade?.ts ?? null,
      },
    };

    const stats = JSON.stringify(body);
    return { stats, request_id: requestId };
  }
}
