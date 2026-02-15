"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class AddToBagsNode extends LGraphNode {
  static title = "Add To Bags";
  static desc = "After a successful buy, add position to clanker_bags.json with profit target and stop loss.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Add To Bags";

    this.addInput("buy_result", "object");
    this.addInput("state", "object");
    this.addInput("base_path", "string");
    this.addInput("storage_instance", "object");
    this.addInput("profit_target_percent", "string");
    this.addInput("stop_loss_percent", "string");

    this.addOutput("success", "boolean");
    this.addOutput("holding", "object");

    this.size = [240, 140];
    (this as any).type = "add_to_bags";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("add_to_bags", AddToBagsNode);
}

export default AddToBagsNode;
