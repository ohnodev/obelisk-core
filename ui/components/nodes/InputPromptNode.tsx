"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class InputPromptNode extends LGraphNode {
  static title = "Input Prompt";
  static desc = "User input prompt node";
  static title_color = "#d4af37";

  constructor() {
    super();
    this.addOutput("text", "string");
    this.addProperty("prompt", "", "string");
    this.size = [200, 60];
  }

  onExecute() {
    const prompt = (this.properties as any)?.prompt || "";
    this.setOutputData(0, prompt);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(212, 175, 55, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

LiteGraph.registerNodeType("input_prompt", InputPromptNode);

export default InputPromptNode;
