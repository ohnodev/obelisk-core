"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class InputPromptNode extends LGraphNode {
  static title = "Input Prompt";
  static desc = "User input prompt node";
  static title_color = "#4a9eff";

  constructor() {
    super();
    this.addOutput("text", "string");
    this.addProperty("prompt", "", "string");
    this.size = [200, 60];
    (this as any).type = "input_prompt";
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(74, 158, 255, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }

  onExecute() {
    const prompt = (this.properties as any)?.prompt || "";
    this.setOutputData(0, prompt);
  }

}

LiteGraph.registerNodeType("input_prompt", InputPromptNode);

export default InputPromptNode;
