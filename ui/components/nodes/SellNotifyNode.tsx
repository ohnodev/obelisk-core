"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class SellNotifyNode extends LGraphNode {
  static title = "Sell Notify";
  static desc = "When Clanker Sell succeeds, builds a Telegram reply with sell message. Connect to TG Action with chat_id.";
  static title_color = "#c05050";

  constructor() {
    super();
    this.title = "Sell Notify";

    this.addInput("sell_result", "object");
    this.addInput("chat_id", "string");

    this.addOutput("actions", "array");
    this.addOutput("chat_id", "string");

    this.size = [220, 100];
    (this as any).type = "sell_notify";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("sell_notify", SellNotifyNode);
}

export default SellNotifyNode;
