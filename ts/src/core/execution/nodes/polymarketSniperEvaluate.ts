import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { asString } from "./polymarketShared";

const logger = getLogger("polymarketSniperEvaluate");

const MIN_ORDER_SHARES = 5;
const ROUND_DURATION_SEC = 300; // Polymarket 5-min window
const DEFAULT_DISTANCE_MAX_ABS = 0.1; // max |distance_pct| allowed (0.1 = 10%)

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Interpolate edge from start of window (maxRemaining) to t=0. Returns 0 if edge_at_t_minus_0 is 0 (gradient disabled). */
function edgeFromGradient(
  timeRemainingSec: number,
  maxRemainingSec: number,
  edgeAtStart: number,
  edgeAtT0: number
): number {
  if (edgeAtT0 === 0 || maxRemainingSec <= 0) return 0;
  const frac = Math.max(0, Math.min(1, timeRemainingSec / maxRemainingSec));
  return edgeAtStart * frac + edgeAtT0 * (1 - frac);
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
      ) ?? ROUND_DURATION_SEC;

    const roundDurationSec =
      toNum(
        this.getInputValue("round_duration_sec", context, undefined) ??
          this.resolveEnvVar(this.metadata.round_duration_sec) ??
          process.env.POLYMARKET_ROUND_DURATION_SEC
      ) || ROUND_DURATION_SEC;

    const edgeAtTMinus0 =
      toNum(
        this.getInputValue("edge_at_t_minus_0", context, undefined) ??
          this.resolveEnvVar(this.metadata.edge_at_t_minus_0) ??
          process.env.POLYMARKET_EDGE_AT_T_MINUS_0
      );

    const rawDistance =
      this.getInputValue("distance_max_abs", context, undefined) ??
      this.resolveEnvVar(this.metadata.distance_max_abs) ??
      process.env.POLYMARKET_DISTANCE_MAX_ABS;
    const distanceMaxAbs =
      rawDistance === undefined || rawDistance === null || String(rawDistance).trim() === ""
        ? DEFAULT_DISTANCE_MAX_ABS
        : toNum(rawDistance);

    // time_window_min/max are "seconds INTO the round"; timeRemaining is seconds LEFT
    // seconds_into = roundDuration - timeRemaining
    // We need: timeWindowMin <= seconds_into <= timeWindowMax
    // => roundDuration - timeWindowMax <= timeRemaining <= roundDuration - timeWindowMin
    const minRemainingAllowed = Math.max(0, roundDurationSec - timeWindowMax);
    const maxRemainingAllowed = roundDurationSec - timeWindowMin;

    const useMarketOrderRaw =
      this.getInputValue("use_market_order", context, undefined) ??
      this.resolveEnvVar(this.metadata.use_market_order) ??
      this.metadata.use_market_order ??
      process.env.POLYMARKET_USE_MARKET_ORDER;
    const useMarketOrder =
      useMarketOrderRaw === true ||
      String(useMarketOrderRaw).trim().toLowerCase() === "true" ||
      useMarketOrderRaw === "1";

    const probabilityModelRaw =
      this.getInputValue("probability_model", context, undefined) ??
      this.resolveEnvVar(this.metadata.probability_model) ??
      this.metadata.probability_model ??
      process.env.POLYMARKET_PROBABILITY_MODEL ??
      "d_eff";
    let modelKey = String(probabilityModelRaw).trim().toLowerCase();
    if (modelKey === "" || modelKey.includes("{{")) modelKey = "d_eff";
    const useZmove =
      modelKey === "zmove" ||
      modelKey === "d_eff" ||
      modelKey === "deff" ||
      modelKey === "z_move";

    const gbmPUp = toNum(snapshot.modelPUp ?? snapshot.model_p_up ?? 0.5);
    const zmovePUp = toNum(snapshot.modelPUpZMove ?? snapshot.model_p_up_z_move ?? 0.5);
    const modelPUp = useZmove ? zmovePUp : gbmPUp;
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

    const distanceOk = distanceMaxAbs === 0 || Math.abs(distancePct) <= distanceMaxAbs;
    if (
      timeRemaining < minRemainingAllowed ||
      timeRemaining > maxRemainingAllowed ||
      !distanceOk
    ) {
      const sniper_context = {
        not_in_window: {
          time_remaining_sec: timeRemaining,
          seconds_into_round: roundDurationSec - timeRemaining,
          distance_pct: distancePct,
          distance_max_abs: distanceMaxAbs,
          time_window_min_sec: timeWindowMin,
          time_window_max_sec: timeWindowMax,
          round_duration_sec: roundDurationSec,
        },
      };
      return {
        success: true,
        signal: "none",
        skip: true,
        reason: "not_in_window",
        sniper_context,
      };
    }

    const upEdge = modelPUp - mktUp;
    const downEdge = 1 - modelPUp - mktDown;
    const gradientEdge = edgeFromGradient(timeRemaining, maxRemainingAllowed, edgeThreshold, edgeAtTMinus0);
    const threshold = gradientEdge === 0 ? edgeThreshold : gradientEdge;

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
      const sniper_context = {
        no_signal: {
          model_p_up: modelPUp,
          mkt_up: mktUp,
          mkt_down: mktDown,
          up_edge: upEdge,
          down_edge: downEdge,
          threshold,
          time_remaining_sec: timeRemaining,
        },
      };
      return {
        success: true,
        signal: "none",
        skip: true,
        reason: "no_signal",
        upEdge,
        downEdge,
        threshold,
        sniper_context,
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
