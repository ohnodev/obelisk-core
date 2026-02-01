"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class SamplerNode extends LGraphNode {
  static title = "Sampler";
  static desc = "Generates LLM response";
  static title_color = "#f7768e";

  constructor() {
    super();
    this.title = "Sampler";
    this.addInput("query", "string");
    this.addInput("model", "object");
    this.addInput("memory", "object"); // Input from Memory Adapter
    this.addOutput("response", "string");
    this.addProperty("quantum_influence", 0.7, "number");
    this.addProperty("max_length", 1024, "number");
    this.size = [200, 120];
    (this as any).type = "sampler";
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
    const query = this.getInputData(0);
    const model = this.getInputData(1);
    const memory = this.getInputData(2); // Get memory from Memory Adapter
    const quantumInfluence = (this.properties as any)?.quantum_influence || 0.7;
    const maxLength = (this.properties as any)?.max_length || 1024;

    // In a real implementation, this would call the LLM with memory context
    // For now, we just pass through a placeholder
    const response = `[Sampler: query="${query}", quantum=${quantumInfluence}, max_len=${maxLength}]`;
    this.setOutputData(0, response);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(247, 118, 142, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph) {
  LiteGraph.registerNodeType("sampler", SamplerNode);
}

export default SamplerNode;
