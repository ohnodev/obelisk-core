"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketStatusListenerNode extends LGraphNode {
  static title = "Polymarket Status Listener";
  static desc =
    "GET /stats for dashboard. Connect Express Service; connect to Polymarket Stats + HTTP Response.";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Status Listener";

    this.addInput("express_service", "object");

    this.addOutput("trigger", "boolean");
    this.addOutput("request_id", "string");
    this.addOutput("path", "string");
    this.addOutput("method", "string");
    this.addOutput("query", "string");

    this.size = [300, 200];
    (this as any).type = "polymarket_status_listener";
    (this as any).resizable = true;

    this.addProperty("port", 8081, "number");
    this.addWidget(
      "number" as any,
      "port",
      8081,
      (value: number) => {
        const num = Number(value);
        const port = Number.isFinite(num) ? Math.max(1, Math.min(65535, Math.floor(num))) : 8081;
        this.setProperty("port", port);
      },
      { min: 1, max: 65535, step: 1, serialize: true, property: "port" } as any
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
  LiteGraph.registerNodeType("polymarket_status_listener", PolymarketStatusListenerNode);
}

export default PolymarketStatusListenerNode;
