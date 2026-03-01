import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolvePolymarketTradesPath } from "./polymarketStoragePath";

const logger = getLogger("polymarketTradeLogger");

const DEFAULT_MAX_TRADES = 100;

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class PolymarketTradeLoggerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, logged: false, reason: "trigger is false" };
    }

    const tradesPath = resolvePolymarketTradesPath(this, context);
    if (!tradesPath) {
      return { success: false, logged: false, error: "storage path not resolved" };
    }

    const tradeRaw = this.getInputValue("trade", context, undefined);
    const tokenId = this.getInputValue("token_id", context, undefined);
    const price = this.getInputValue("price", context, undefined);
    const size = this.getInputValue("size", context, undefined);
    const outcome = this.getInputValue("outcome", context, undefined);
    const actionRaw = this.getInputValue("action", context, undefined) ?? "order_placed";
    const orderResult = this.getInputValue("order_result", context, undefined) as Record<string, unknown> | undefined;

    const maxTrades = Math.min(
      1000,
      Math.max(1, Number(this.getInputValue("max_trades", context, this.metadata.max_trades ?? DEFAULT_MAX_TRADES)) || DEFAULT_MAX_TRADES)
    );

    const entries: Array<Record<string, unknown>> = [];

    if (orderResult?.success && !orderResult?.skipped) {
      const trade = tradeRaw && typeof tradeRaw === "object" ? (tradeRaw as Record<string, unknown>) : {};
      entries.push({
        type: String(actionRaw),
        ts: Date.now(),
        side: trade.side ?? "BUY",
        size: size ?? trade.size ?? (orderResult.response as Record<string, unknown>)?.size,
        price: price ?? trade.price ?? (orderResult.response as Record<string, unknown>)?.price,
        token_id: tokenId ?? trade.token_id ?? (orderResult.response as Record<string, unknown>)?.tokenId,
        order_id: orderResult.order_id ?? (orderResult.response as Record<string, unknown>)?.orderId,
        outcome: outcome ?? trade.outcome ?? (orderResult.response as Record<string, unknown>)?.outcome ?? "Unknown",
      });
    } else if (tradeRaw && typeof tradeRaw === "object") {
      const t = tradeRaw as Record<string, unknown>;
      if (t.side || t.token_id || t.order_id) {
        entries.push({
          type: String(actionRaw),
          ts: Date.now(),
          side: t.side ?? "BUY",
          size: t.size,
          price: t.price,
          token_id: t.token_id,
          order_id: t.order_id,
          outcome: t.outcome ?? "Unknown",
        });
      }
    }

    if (entries.length === 0) {
      return { success: true, logged: false };
    }

    let list: unknown[] = [];
    if (fs.existsSync(tradesPath)) {
      try {
        const raw = fs.readFileSync(tradesPath, "utf-8");
        const data = JSON.parse(raw);
        list = Array.isArray(data) ? data : (data?.trades ?? []);
      } catch (e) {
        logger.warn(`[PolymarketTradeLogger] Failed to read ${abbrevPathForLog(tradesPath)}: ${e}`);
      }
    }

    list.push(...entries);
    list = (list as unknown[]).slice(-maxTrades);

    try {
      ensureDir(tradesPath);
      fs.writeFileSync(tradesPath, JSON.stringify(list, null, 2), "utf-8");
      logger.info(`[PolymarketTradeLogger] Appended ${entries.length} trade(s)`);
      return { success: true, logged: true, logged_count: entries.length };
    } catch (e) {
      logger.warn(`[PolymarketTradeLogger] Failed to write ${abbrevPathForLog(tradesPath)}: ${e}`);
      return { success: false, logged: false, error: String(e) };
    }
  }
}
