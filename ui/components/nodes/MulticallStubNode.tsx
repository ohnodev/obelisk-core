"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MulticallStubNode extends LGraphNode {
  static title = "Multicall Stub";
  static desc =
    "Placeholder for Base-chain multicall that fills the user's order via Basemarket. No-op for now; replace when contract is ready.";
  static title_color = "#27ae60";

  constructor() {
    super();
    this.title = "Multicall Stub";

    this.addInput("trigger", "boolean");
    this.addInput("order_id", "string");
    this.addInput("request_id", "string");

    this.addOutput("success", "boolean");
    this.addOutput("order_id", "string");
    this.addOutput("request_id", "string");

    this.size = [200, 100];
    (this as any).type = "multicall_stub";
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
    ctx.fillStyle = "rgba(39, 174, 96, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("multicall_stub", MulticallStubNode);
}

export default MulticallStubNode;
