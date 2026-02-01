"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ModelLoaderNode extends LGraphNode {
  static title = "Model Loader";
  static desc = "Loads the LLM model";
  static title_color = "#7aa2f7";

  constructor() {
    super();
    this.title = "Model Loader";
    this.addOutput("model", "object");
    this.size = [200, 60];
    (this as any).type = "model_loader";
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
    // In a real implementation, this would load the model
    // For now, we just pass through a model reference
    this.setOutputData(0, { type: "model", loaded: true });
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(122, 162, 247, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph) {
  LiteGraph.registerNodeType("model_loader", ModelLoaderNode);
}

export default ModelLoaderNode;
