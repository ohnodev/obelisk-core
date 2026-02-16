"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ExpressServiceNode extends LGraphNode {
  static title = "Express Service";
  static desc = "Provider: shared HTTP server only (no reads, no execution). Listeners register routes on it; connect Stats + Sell Bags Listeners to reuse one port.";
  static title_color = "#3498db";

  constructor() {
    super();
    this.title = "Express Service";
    this.addOutput("express_service", "object");
    this.size = [240, 80];
    (this as any).type = "express_service";
    (this as any).resizable = true;
    this.addProperty("port", 8081, "number");
    this.addProperty("host", "0.0.0.0", "string");
    this.addWidget("number" as any, "port", 8081, (value: number) => {
      const num = Number(value);
      const port = Number.isFinite(num) ? Math.max(1, Math.min(65535, Math.floor(num))) : 8081;
      this.setProperty("port", port);
    }, { min: 1, max: 65535, step: 1, serialize: true, property: "port" } as any);
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    if ((this as any).is_selected || (this as any).isSelected) {
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
  LiteGraph.registerNodeType("express_service", ExpressServiceNode);
}

export default ExpressServiceNode;
