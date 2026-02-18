"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class SellBagsListenerNode extends LGraphNode {
  static title = "Sell Bags Listener";
  static desc = "POST /sell-all-bags on shared Express. Connect from Express Service; connect to Sell All Bags and HTTP Response.";
  static title_color = "#e67e22";

  constructor() {
    super();
    this.title = "Sell Bags Listener";

    this.addInput("express_service", "object");

    this.addOutput("request_id", "string");
    this.addOutput("trigger", "boolean");
    this.addOutput("path", "string");
    this.addOutput("method", "string");

    this.size = [260, 120];
    (this as any).type = "sell_bags_listener";
    (this as any).resizable = true;

    this.addProperty("path", "/sell-all-bags", "string");
    this.addWidget(
      "text" as any,
      "path",
      "/sell-all-bags",
      (value: string) => this.setProperty("path", value),
      { serialize: true, property: "path" } as any
    );
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) return;
    ctx.fillStyle = "rgba(230, 126, 34, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("sell_bags_listener", SellBagsListenerNode);
}

export default SellBagsListenerNode;
