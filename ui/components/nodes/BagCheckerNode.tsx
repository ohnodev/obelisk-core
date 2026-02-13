"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BagCheckerNode extends LGraphNode {
  static title = "Bag Checker";
  static desc = "On new swap: check if we hold that token; compare price to profit target / stop loss; output should_sell + sell_params.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Bag Checker";

    this.addInput("trigger", "boolean");
    this.addInput("swap", "object");
    this.addInput("state", "object");
    this.addInput("state_path", "string");
    this.addInput("bag_state_path", "string");

    this.addOutput("should_sell", "boolean");
    this.addOutput("sell_params", "object");
    this.addOutput("holding", "object");

    this.size = [240, 140];
    (this as any).type = "bag_checker";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("bag_checker", BagCheckerNode);
}

export default BagCheckerNode;
