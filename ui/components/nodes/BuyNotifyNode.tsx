"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BuyNotifyNode extends LGraphNode {
  static title = "Buy Notify";
  static desc = "When Clanker Buy succeeds, sends a Telegram buy notification. Connect chat_id and optionally bot_token (e.g. from Text node with {{process.env.TELEGRAM_BOT_TOKEN}}).";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Buy Notify";

    this.addInput("buy_result", "object");
    this.addInput("chat_id", "string");
    this.addInput("bot_token", "string");

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
