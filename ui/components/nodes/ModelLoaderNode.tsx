"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class ModelLoaderNode extends LGraphNode {
  static title = "Model Loader";
  static desc = "Loads the LLM model";
  static title_color = "#d4af37";

  constructor() {
    super();
    this.addOutput("model", "object");
    this.size = [200, 60];
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
    ctx.fillStyle = "rgba(212, 175, 55, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

LiteGraph.registerNodeType("model_loader", ModelLoaderNode);

export default ModelLoaderNode;
