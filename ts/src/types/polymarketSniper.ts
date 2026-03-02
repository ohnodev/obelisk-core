/**
 * Schema for Polymarket Sniper actions.
 * Used by polymarket_actions.json and /polymarket/stats lastActions.
 * Designed for frontend parsing and visual cues (e.g. edge gauges, animations).
 */
export const POLYMARKET_SNIPER_ACTION_SCHEMA_VERSION = 1;

export type SniperActionType = "order_placed" | "no_action";
export type SniperSkipReason = "order_placed" | "not_in_window" | "no_signal";

/** Context when skipped because outside actionable time/distance window */
export interface SniperNotInWindowContext {
  time_remaining_sec: number;
  distance_pct: number;
  time_window_min_sec?: number;
  time_window_max_sec?: number;
}

/** Context when in window but edge below threshold (no signal) */
export interface SniperNoSignalContext {
  /** Model's probability for YES */
  model_p_up: number;
  /** Market price for YES (logged probability) */
  mkt_up: number;
  /** Market price for NO */
  mkt_down: number;
  /** Edge for YES: model_p_up - mkt_up */
  up_edge: number;
  /** Edge for NO: (1 - model_p_up) - mkt_down */
  down_edge: number;
  /** Threshold required to trigger */
  threshold: number;
  time_remaining_sec?: number;
}

/** Structured context for no_action entries */
export interface SniperActionContext {
  not_in_window?: SniperNotInWindowContext;
  no_signal?: SniperNoSignalContext;
}

export interface PolymarketSniperAction {
  ts: number;
  action: SniperActionType;
  /** Canonical reason: order_placed | not_in_window | no_signal */
  reason: SniperSkipReason;
  /** Schema version for frontend compatibility */
  schema_version?: number;
  /** Int node parse errors (e.g. time_window_min/max) for traceability */
  parse_errors?: string[];
  /** Detailed context for no_action entries */
  context?: SniperActionContext;
  /** For order_placed */
  token_id?: string;
  order_id?: string;
  price?: number;
  size?: number;
}
