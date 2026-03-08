"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class LpFillOrderListenerNode extends LGraphNode {
  static title = "LP Fill Order Listener";
  static desc =
    "POST /lp/fill-order on shared Express. Connect from Express Service; connect to Polymarket LP Fill Order and HTTP Response.";
  static title_color = "#9b59b6";

  constructor() {
    super();
    this.title = "LP Fill Order Listener";

    this.addInput("express_service", "object");

    this.addOutput("trigger", "boolean");
    this.addOutput("request_id", "string");
    this.addOutput("raw_body", "string");
    this.addOutput("path", "string");
    this.addOutput("method", "string");

    this.size = [260, 150];
    (this as any).type = "lp_fill_order_listener";
    (this as any).resizable = true;

    this.addProperty("path", "/lp/fill-order", "string");
    this.addWidget(
      "text" as any,
      "path",
      "/lp/fill-order",
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
    ctx.fillStyle = "rgba(155, 89, 182, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("lp_fill_order_listener", LpFillOrderListenerNode);
}

export default LpFillOrderListenerNode;
