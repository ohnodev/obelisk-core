/**
 * PolymarketTradeOutcomeUpdaterNode – after housekeeping, matches resolved positions
 * to trades by token_id and updates outcome + pnl in polymarket_trades.json.
 * Connect: trigger + housekeeping_response from Polymarket Action, storage_instance from Storage.
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolvePolymarketTradesPath } from "./polymarketStoragePath";

const logger = getLogger("polymarketTradeOutcomeUpdater");

interface ResolvedPosition {
  asset: string;
  outcome: "Won" | "Lost";
  pnl: number;
}

interface TradeRecord {
  type?: string;
  ts?: number;
  side?: string;
  size?: number;
  price?: number;
  token_id?: string;
  order_id?: string;
  outcome?: string;
  pnl?: number;
  [k: string]: unknown;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class PolymarketTradeOutcomeUpdaterNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, updated: 0, reason: "trigger is false" };
    }

    const responseRaw = this.getInputValue(
      "housekeeping_response",
      context,
      undefined
    ) ?? this.getInputValue("response", context, undefined);
    const response =
      responseRaw && typeof responseRaw === "object"
        ? (responseRaw as Record<string, unknown>)
        : {};
    const resolvedPositions = (response.resolvedPositions ?? []) as ResolvedPosition[];
    if (resolvedPositions.length === 0) {
      return { success: true, updated: 0, reason: "no resolved positions" };
    }

    const tradesPath = resolvePolymarketTradesPath(this, context);
    if (!tradesPath) {
      return { success: false, updated: 0, error: "storage path not resolved" };
    }

    let list: TradeRecord[] = [];
    if (fs.existsSync(tradesPath)) {
      try {
        const raw = fs.readFileSync(tradesPath, "utf-8");
        const data = JSON.parse(raw);
        list = Array.isArray(data) ? data : (data?.trades ?? []);
      } catch (e) {
        logger.warn(
          `[PolymarketTradeOutcomeUpdater] Failed to read ${abbrevPathForLog(tradesPath)}: ${e}`
        );
        return { success: false, updated: 0, error: String(e) };
      }
    }

    let updatedCount = 0;
    const outcomeNorm = (o: string) => String(o).toLowerCase();
    const assetNorm = (a: string) => String(a || "").toLowerCase().trim();

    for (const pos of resolvedPositions) {
      const asset = assetNorm(pos.asset);
      if (!asset) continue;
      const outcome = pos.outcome === "Won" || pos.outcome === "Lost" ? pos.outcome : null;
      if (!outcome) continue;
      const pnl = typeof pos.pnl === "number" ? pos.pnl : 0;

      const matching = list.filter(
        (t) =>
          outcomeNorm(t.outcome ?? "") === "unknown" &&
          assetNorm(t.token_id ?? "") === asset
      );
      if (matching.length === 0) continue;

      const totalSize = matching.reduce((s, t) => s + (Number(t.size) || 0), 0);
      for (const t of matching) {
        const size = Number(t.size) || 0;
        const tradePnl =
          totalSize > 0 ? (size / totalSize) * pnl : pnl / matching.length;
        t.outcome = outcome;
        t.pnl = tradePnl;
        updatedCount++;
        logger.info(
          `[PolymarketTradeOutcomeUpdater] Trade token_id=${asset.slice(0, 12)}… resolved: ${outcome} PnL=${tradePnl.toFixed(2)}`
        );
      }
    }

    if (updatedCount === 0) {
      return { success: true, updated: 0, reason: "no matching trades to update" };
    }

    try {
      ensureDir(tradesPath);
      fs.writeFileSync(tradesPath, JSON.stringify(list, null, 2), "utf-8");
      logger.info(
        `[PolymarketTradeOutcomeUpdater] Updated ${updatedCount} trade(s) with resolved outcomes`
      );
      return { success: true, updated: updatedCount };
    } catch (e) {
      logger.warn(
        `[PolymarketTradeOutcomeUpdater] Failed to write ${abbrevPathForLog(tradesPath)}: ${e}`
      );
      return { success: false, updated: 0, error: String(e) };
    }
  }
}
