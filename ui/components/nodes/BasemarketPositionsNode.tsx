"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BasemarketPositionsNode extends LGraphNode {
  static title = "Basemarket Positions";
  static desc = "GET /api/trade/positions?user=...";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Basemarket Positions";

    this.addInput("trigger", "boolean");
    this.addInput("base_url", "string");
    this.addInput("private_key", "string");
    this.addInput("user_address", "string");
    this.addOutput("success", "boolean");
    this.addOutput("positions", "array");
    this.addOutput("active_sell_orders", "array");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.addProperty("base_url", "{{process.env.BASEMARKET_API_URL}}", "string");
    this.addProperty("user_address", "{{process.env.BASEMARKET_USER_ADDRESS}}", "string");

    this.addWidget("string", "base_url", "{{process.env.BASEMARKET_API_URL}}", (value: string) => {
      this.setProperty("base_url", value);
    }, { serialize: true });
    this.addWidget("string", "user_address", "{{process.env.BASEMARKET_USER_ADDRESS}}", (value: string) => {
      this.setProperty("user_address", value);
    }, { serialize: true });

    this.size = [320, 185];
    (this as any).type = "basemarket_positions";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("basemarket_positions", BasemarketPositionsNode);
}

export default BasemarketPositionsNode;
