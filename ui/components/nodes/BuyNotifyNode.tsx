"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BuyNotifyNode extends LGraphNode {
  static title = "Buy Notify";
  static desc = "When Clanker Buy succeeds, sends a Telegram buy notification. Configure bot_token and chat_id below (supports {{process.env.…}} syntax).";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Buy Notify";

    this.addInput("buy_result", "object");
    this.addInput("state", "object");

    this.addOutput("sent", "boolean");
    this.addOutput("chat_id", "string");

    this.addProperty("bot_token", "{{process.env.TELEGRAM_BOT_TOKEN}}", "string");
    this.addProperty("chat_id", "{{process.env.TELEGRAM_CHAT_ID}}", "string");
    this.addWidget("string", "bot_token", "{{process.env.TELEGRAM_BOT_TOKEN}}", (value: string) => {
      this.setProperty("bot_token", value);
    }, { serialize: true });
    this.addWidget("string", "chat_id", "{{process.env.TELEGRAM_CHAT_ID}}", (value: string) => {
      this.setProperty("chat_id", value);
    }, { serialize: true });

    this.size = [280, 130];
    (this as any).type = "buy_notify";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (!widgets) return;
    if (name === "bot_token") {
      const w = widgets.find((x: any) => x.name === "bot_token");
      if (w) w.value = value ?? "";
    }
    if (name === "chat_id") {
      const w = widgets.find((x: any) => x.name === "chat_id");
      if (w) w.value = value ?? "";
    }
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("buy_notify", BuyNotifyNode);
}

export default BuyNotifyNode;
