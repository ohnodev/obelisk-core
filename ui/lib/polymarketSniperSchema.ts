/**
 * Polymarket Sniper Action schema – mirrors backend ts/src/types/polymarketSniper.ts.
 * Used for typing lastActions from /polymarket/stats and polymarket_actions.json.
 * Frontend can use these types for parsing and building visual cues (edge gauges, animations).
 */
export const POLYMARKET_SNIPER_ACTION_SCHEMA_VERSION = 1;

export type SniperActionType = "order_placed" | "no_action";
export type SniperSkipReason = "order_placed" | "not_in_window" | "no_signal";

export interface SniperNotInWindowContext {
  time_remaining_sec: number;
  distance_pct: number;
  time_window_min_sec?: number;
  time_window_max_sec?: number;
}

export interface SniperNoSignalContext {
  model_p_up: number;
  mkt_up: number;
  mkt_down: number;
  up_edge: number;
  down_edge: number;
  threshold: number;
  time_remaining_sec?: number;
}

export interface SniperActionContext {
  not_in_window?: SniperNotInWindowContext;
  no_signal?: SniperNoSignalContext;
}

export interface PolymarketSniperAction {
  ts: number;
  action: SniperActionType;
  reason: SniperSkipReason;
  schema_version?: number;
  context?: SniperActionContext;
  token_id?: string;
  order_id?: string;
  price?: number;
  size?: number;
}
