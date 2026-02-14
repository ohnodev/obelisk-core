"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class UpdateBagsOnSellNode extends LGraphNode {
  static title = "Update Bags On Sell";
  static desc = "After a successful sell, remove that token from clanker_bags.json.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Update Bags On Sell";

    this.addInput("sell_result", "object");
    this.addInput("base_path", "string");
    this.addInput("storage_instance", "object");

    this.addOutput("success", "boolean");

    this.size = [220, 90];
    (this as any).type = "update_bags_on_sell";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("update_bags_on_sell", UpdateBagsOnSellNode);
}

export default UpdateBagsOnSellNode;
