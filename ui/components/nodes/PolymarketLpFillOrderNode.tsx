"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketLpFillOrderNode extends LGraphNode {
  static title = "Polymarket LP Fill Order";
  static desc =
    "Calls polymarket-service POST /api/trading/lp/fill-order. Place limit SELL, poll for fill or revert. Connect from LP Fill Order Listener (trigger, request_id, raw_body).";
  static title_color = "#3498db";

  constructor() {
    super();
    this.title = "Polymarket LP Fill Order";

    this.addInput("trigger", "boolean");
    this.addInput("request_id", "string");
    this.addInput("raw_body", "string");
    this.addInput("base_url", "string");
    this.addInput("private_key", "string");

    this.addOutput("success", "boolean");
    this.addOutput("filled", "boolean");
    this.addOutput("orderId", "string");
    this.addOutput("error", "string");
    this.addOutput("request_id", "string");
    this.addOutput("status_code", "number");
    this.addOutput("response_body", "object");

    this.size = [300, 180];
    (this as any).type = "polymarket_lp_fill_order";
    (this as any).resizable = true;

    this.addProperty("base_url", "", "string");
    this.addWidget(
      "text" as any,
      "base_url",
      "",
      (value: string) => this.setProperty("base_url", value),
      { serialize: true, property: "base_url" } as any
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
    ctx.fillStyle = "rgba(52, 152, 219, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_lp_fill_order", PolymarketLpFillOrderNode);
}

export default PolymarketLpFillOrderNode;
