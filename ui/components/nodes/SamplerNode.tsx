"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class SamplerNode extends LGraphNode {
  static title = "Sampler";
  static desc = "Generates LLM response";
  static title_color = "#d4af37";

  constructor() {
    super();
    this.addInput("query", "string");
    this.addInput("model", "object");
    this.addInput("context", "object");
    this.addOutput("response", "string");
    this.addProperty("quantum_influence", 0.7, "number");
    this.addProperty("max_length", 1024, "number");
    this.size = [200, 120];
  }

  onExecute() {
    const query = this.getInputData(0);
    const model = this.getInputData(1);
    const context = this.getInputData(2);
    const quantumInfluence = (this.properties as any)?.quantum_influence || 0.7;
    const maxLength = (this.properties as any)?.max_length || 1024;

    // In a real implementation, this would call the LLM
    // For now, we just pass through a placeholder
    const response = `[Sampler: query="${query}", quantum=${quantumInfluence}, max_len=${maxLength}]`;
    this.setOutputData(0, response);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(212, 175, 55, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

LiteGraph.registerNodeType("sampler", SamplerNode);

export default SamplerNode;
