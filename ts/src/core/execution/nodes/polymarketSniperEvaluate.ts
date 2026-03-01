import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString } from "./polymarketShared";

const logger = getLogger("polymarketSniperEvaluate");

const MIN_ORDER_SHARES = 5;
const LATE_SNIPER_TIME_MAX = 60;
const LATE_SNIPER_EDGE_AT_60S = 0.3;
const LATE_SNIPER_EDGE_AT_0S = 0.15;
const DISTANCE_MAX_ABS = 0.1;

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lateSniperThreshold(timeRemainingSec: number): number {
  const t = Math.max(0, Math.min(LATE_SNIPER_TIME_MAX, timeRemainingSec));
  const frac = t / LATE_SNIPER_TIME_MAX;
  return LATE_SNIPER_EDGE_AT_60S * frac + LATE_SNIPER_EDGE_AT_0S * (1 - frac);
}

export class PolymarketSniperEvaluateNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, skipped: true, signal: "none", skip: true };
    }

    const snapshotRaw = this.getInputValue("snapshot", context, undefined);
    const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? (snapshotRaw as Record<string, unknown>) : null;
    if (!snapshot) {
      return {
        success: false,
        signal: "none",
        skip: true,
        error: "snapshot is required",
      };
    }

    const edgeThreshold =
      toNum(
        this.getInputValue("edge_threshold", context, undefined) ??
          this.resolveEnvVar(this.metadata.edge_threshold) ??
          process.env.POLYMARKET_EDGE_THRESHOLD
      ) || 0.15;

    const orderNotional =
      toNum(
        this.getInputValue("order_notional", context, undefined) ??
          this.resolveEnvVar(this.metadata.order_notional) ??
          process.env.POLYMARKET_ORDER_NOTIONAL
      ) || 5;

    const timeWindowMin =
      toNum(
        this.getInputValue("time_window_min_sec", context, undefined) ??
          this.resolveEnvVar(this.metadata.time_window_min_sec) ??
          this.metadata.time_window_min_sec ??
          process.env.POLYMARKET_TIME_WINDOW_MIN_SEC
      ) ?? 0;

    const timeWindowMax =
      toNum(
        this.getInputValue("time_window_max_sec", context, undefined) ??
          this.resolveEnvVar(this.metadata.time_window_max_sec) ??
          this.metadata.time_window_max_sec ??
          process.env.POLYMARKET_TIME_WINDOW_MAX_SEC
      ) ?? 60;

    const useMarketOrderRaw =
      this.getInputValue("use_market_order", context, undefined) ??
      this.resolveEnvVar(this.metadata.use_market_order) ??
      this.metadata.use_market_order ??
      process.env.POLYMARKET_USE_MARKET_ORDER;
    const useMarketOrder =
      useMarketOrderRaw === true ||
      String(useMarketOrderRaw).trim().toLowerCase() === "true" ||
      useMarketOrderRaw === "1";

    const modelPUp = toNum(snapshot.modelPUp ?? snapshot.model_p_up ?? 0.5);
    const timeRemaining = toNum(snapshot.timeRemaining ?? snapshot.time_remaining ?? 0);
    const distancePct = toNum(snapshot.distancePct ?? snapshot.distance_pct ?? 0);

    const current = snapshot.current as Record<string, unknown> | undefined;
    if (!current || typeof current !== "object") {
      return {
        success: false,
        signal: "none",
        skip: true,
        error: "snapshot.current is required",
      };
    }

    const mktUp = toNum(current.mktUp ?? current.mkt_up ?? current.bestBid ?? current.best_bid ?? 0.5);
    const mktDown = toNum(current.mktDown ?? current.mkt_down ?? (1 - mktUp));

    const upTokenId = asString(current.upTokenId ?? current.up_token_id ?? current.yesTokenId ?? current.yes_token_id ?? "");
    const downTokenId = asString(current.downTokenId ?? current.down_token_id ?? current.noTokenId ?? current.no_token_id ?? "");

    if (
      timeRemaining < timeWindowMin ||
      timeRemaining > timeWindowMax ||
      Math.abs(distancePct) > DISTANCE_MAX_ABS
    ) {
      return {
        success: true,
        signal: "none",
        skip: true,
        reason: "outside time window or distance filter",
      };
    }

    const upEdge = modelPUp - mktUp;
    const downEdge = 1 - modelPUp - mktDown;
    const threshold = Math.max(edgeThreshold, lateSniperThreshold(timeRemaining));

    let signal: "buy_up" | "buy_down" | "none" = "none";
    let tokenId = "";
    let price = 0;
    let outcome: "YES" | "NO" = "YES";

    if (upEdge >= threshold && upTokenId) {
      signal = "buy_up";
      tokenId = upTokenId;
      price = mktUp;
      outcome = "YES";
    } else if (downEdge >= threshold && downTokenId) {
      signal = "buy_down";
      tokenId = downTokenId;
      price = mktDown;
      outcome = "NO";
    }

    if (signal === "none") {
      return {
        success: true,
        signal: "none",
        skip: true,
        upEdge,
        downEdge,
        threshold,
      };
    }

    const size = Math.max(orderNotional / (price || 0.01), MIN_ORDER_SHARES);

    logger.info(
      `[PolymarketSniperEvaluate ${this.nodeId}] signal=${signal} outcome=${outcome} price=${price} size=${size}`
    );

    return {
      success: true,
      signal,
      skip: false,
      token_id: tokenId,
      price,
      size,
      outcome,
      use_market_order: useMarketOrder,
      upEdge,
      downEdge,
      threshold,
    };
  }
}
