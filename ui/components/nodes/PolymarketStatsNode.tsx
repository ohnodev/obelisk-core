"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketStatsNode extends LGraphNode {
  static title = "Polymarket Stats";
  static desc =
    "Reads polymarket_trades.json from storage. Connect storage_instance from Storage, request_id from Polymarket Status Listener; output to HTTP Response.";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Stats";

    this.addInput("request_id", "string");
    this.addInput("storage_instance", "object");

    this.addOutput("stats", "string");
    this.addOutput("request_id", "string");

    this.size = [260, 100];
    (this as any).type = "polymarket_stats";
    (this as any).resizable = true;
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
    ctx.fillStyle = "rgba(45, 127, 249, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_stats", PolymarketStatsNode);
}

export default PolymarketStatsNode;
