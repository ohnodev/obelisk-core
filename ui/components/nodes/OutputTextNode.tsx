"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class OutputTextNode extends LGraphNode {
  static title = "Output Text";
  static desc = "Displays the final output";
  static title_color = "#e0af68";

  constructor() {
    super();
    this.title = "Output Text";
    this.addInput("response", "string");
    this.size = [200, 60];
    (this as any).type = "output_text";
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

  onExecute() {
    const response = this.getInputData(0);
    // Store the response for display
    this.setProperty("output", response || "");
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(224, 175, 104, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph) {
  LiteGraph.registerNodeType("output_text", OutputTextNode);
}

export default OutputTextNode;
