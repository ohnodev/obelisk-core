"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketActionNode extends LGraphNode {
  static title = "Polymarket Action";
  static desc = "Redeem positions, close orders, or get status";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Action";

    this.addInput("trigger", "boolean");
    this.addInput("base_url", "string");
    this.addInput("action", "string");
    this.addInput("user_address", "string");
    this.addInput("wallet_address", "string");
    this.addInput("private_key", "string");
    this.addOutput("success", "boolean");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.addProperty("action", "status", "string");
    (this as any)._action_widget = this.addWidget(
      "combo",
      "action",
      "status",
      () => {},
      {
        values: ["status", "redeem", "close_orders"],
        serialize: true,
      }
    );

    this.size = [320, 200];
    (this as any).type = "polymarket_action";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_action", PolymarketActionNode);
}

export default PolymarketActionNode;
