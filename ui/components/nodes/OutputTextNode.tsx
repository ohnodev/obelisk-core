"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class OutputTextNode extends LGraphNode {
  static title = "Output Text";
  static desc = "Displays the final output";
  static title_color = "#d4af37";

  constructor() {
    super();
    this.addInput("response", "string");
    this.size = [200, 60];
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
    ctx.fillStyle = "rgba(212, 175, 55, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

LiteGraph.registerNodeType("output_text", OutputTextNode);

export default OutputTextNode;
