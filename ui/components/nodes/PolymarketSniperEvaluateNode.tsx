"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketSniperEvaluateNode extends LGraphNode {
  static title = "Polymarket Sniper Evaluate";
  static desc = "Evaluate snapshot for edge, output buy signal and order params";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Sniper Evaluate";

    this.addInput("trigger", "boolean");
    this.addInput("snapshot", "object");
    this.addInput("edge_threshold", "number");
    this.addInput("order_notional", "number");
    this.addInput("time_window_min_sec", "number");
    this.addInput("time_window_max_sec", "number");
    this.addInput("late_sniper_time_high_sec", "number");
    this.addInput("late_sniper_time_low_sec", "number");
    this.addInput("late_sniper_edge_at_t_minus_60s", "number");
    this.addInput("late_sniper_edge_at_t_minus_10s", "number");
    this.addInput("probability_model", "string");
    this.addInput("use_market_order", "boolean");
    this.addOutput("success", "boolean");
    this.addOutput("signal", "string");
    this.addOutput("skip", "boolean");
    this.addOutput("reason", "string");
    this.addOutput("sniper_context", "object");
    this.addOutput("token_id", "string");
    this.addOutput("price", "number");
    this.addOutput("size", "number");
    this.addOutput("outcome", "string");
    this.addOutput("use_market_order", "boolean");
    this.addOutput("error", "string");

    this.addProperty("edge_threshold", "{{process.env.POLYMARKET_EDGE_THRESHOLD}}", "string");
    this.addProperty("order_notional", "{{process.env.POLYMARKET_ORDER_NOTIONAL}}", "string");
    this.addProperty("probability_model", "{{process.env.POLYMARKET_PROBABILITY_MODEL}}", "string");
    this.addProperty("use_market_order", false, "boolean");
    (this as any)._edge_widget = this.addWidget("string", "edge_threshold", "0.15", () => {}, { serialize: true });
    (this as any)._notional_widget = this.addWidget("string", "order_notional", "5", () => {}, { serialize: true });
    (this as any)._model_widget = this.addWidget("string", "probability_model", "d_eff", () => {}, { serialize: true });
    (this as any)._market_widget = this.addWidget("toggle", "use_market_order", false, () => {}, { serialize: true });

    this.size = [340, 340];
    (this as any).type = "polymarket_sniper_evaluate";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_sniper_evaluate", PolymarketSniperEvaluateNode);
}

export default PolymarketSniperEvaluateNode;
