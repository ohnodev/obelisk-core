"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketActionLoggerNode extends LGraphNode {
  static title = "Polymarket Action Logger";
  static desc = "Log every sniper tick (trade or no-action) for stats visibility";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Action Logger";

    this.addInput("trigger", "boolean");
    this.addInput("order_result", "object");
    this.addInput("skip", "boolean");
    this.addInput("reason", "string");
    this.addInput("sniper_context", "object");
    this.addInput("signal", "string");
    this.addInput("storage_instance", "object");
    this.addInput("parse_error_time_window_min", "string");
    this.addInput("parse_error_time_window_max", "string");
    this.addInput("max_actions", "number");
    this.addOutput("success", "boolean");
    this.addOutput("logged", "boolean");
    this.addOutput("action", "string");
    this.addOutput("reason", "string");

    this.size = [300, 180];
    (this as any).type = "polymarket_action_logger";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_action_logger", PolymarketActionLoggerNode);
}

export default PolymarketActionLoggerNode;
