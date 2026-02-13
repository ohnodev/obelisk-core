"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class OnSwapTriggerNode extends LGraphNode {
  static title = "On Swap Trigger";
  static desc = "Reads last_swap.json from blockchain service; outputs trigger + swap when new swap detected (for bag/sell loop).";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "On Swap Trigger";

    this.addInput("trigger", "boolean");
    this.addInput("swap_file_path", "string");
    this.addInput("state_path", "string");

    this.addOutput("trigger", "boolean");
    this.addOutput("swap", "object");

    this.size = [220, 90];
    (this as any).type = "on_swap_trigger";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("on_swap_trigger", OnSwapTriggerNode);
}

export default OnSwapTriggerNode;
