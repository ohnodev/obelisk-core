"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BasemarketCurrentRoundNode extends LGraphNode {
  static title = "Basemarket Current Round";
  static desc = "GET /api/trade/current-round";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Basemarket Current Round";

    this.addInput("trigger", "boolean");
    this.addInput("base_url", "string");
    this.addOutput("success", "boolean");
    this.addOutput("current_round", "number");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.addProperty("base_url", "{{process.env.BASEMARKET_API_URL}}", "string");
    this.addWidget("string", "base_url", "{{process.env.BASEMARKET_API_URL}}", (value: string) => {
      this.setProperty("base_url", value);
    }, { serialize: true });

    this.size = [300, 120];
    (this as any).type = "basemarket_current_round";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("basemarket_current_round", BasemarketCurrentRoundNode);
}

export default BasemarketCurrentRoundNode;
