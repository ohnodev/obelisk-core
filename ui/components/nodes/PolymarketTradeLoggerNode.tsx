"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketTradeLoggerNode extends LGraphNode {
  static title = "Polymarket Trade Logger";
  static desc = "Append trades to polymarket_trades.json";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Trade Logger";

    this.addInput("trigger", "boolean");
    this.addInput("storage_instance", "object");
    this.addInput("trade", "object");
    this.addInput("token_id", "string");
    this.addInput("price", "number");
    this.addInput("size", "number");
    this.addInput("outcome", "string");
    this.addInput("order_result", "object");
    this.addInput("action", "string");
    this.addInput("max_trades", "number");
    this.addOutput("success", "boolean");
    this.addOutput("logged", "boolean");
    this.addOutput("logged_count", "number");
    this.addOutput("error", "string");

    this.size = [300, 200];
    (this as any).type = "polymarket_trade_logger";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_trade_logger", PolymarketTradeLoggerNode);
}

export default PolymarketTradeLoggerNode;
