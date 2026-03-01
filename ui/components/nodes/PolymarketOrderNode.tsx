"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketOrderNode extends LGraphNode {
  static title = "Polymarket Order";
  static desc = "POST /api/trading/order – place BUY order";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Order";

    this.addInput("trigger", "boolean");
    this.addInput("skip", "boolean");
    this.addInput("base_url", "string");
    this.addInput("token_id", "string");
    this.addInput("price", "number");
    this.addInput("size", "number");
    this.addInput("outcome", "string");
    this.addInput("use_market_order", "boolean");
    this.addInput("user_address", "string");
    this.addInput("wallet_address", "string");
    this.addInput("private_key", "string");
    this.addOutput("success", "boolean");
    this.addOutput("result", "object");
    this.addOutput("order_id", "string");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.size = [320, 280];
    (this as any).type = "polymarket_order";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_order", PolymarketOrderNode);
}

export default PolymarketOrderNode;
