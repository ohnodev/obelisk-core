"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BuyNotifyNode extends LGraphNode {
  static title = "Buy Notify";
  static desc = "When Clanker Buy succeeds, builds a Telegram reply action with buy message. Connect to TG Action with chat_id.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Buy Notify";

    this.addInput("buy_result", "object");
    this.addInput("chat_id", "string");

    this.addOutput("actions", "array");
    this.addOutput("chat_id", "string");

    this.size = [220, 100];
    (this as any).type = "buy_notify";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("buy_notify", BuyNotifyNode);
}

export default BuyNotifyNode;
