"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class InferenceNode extends LGraphNode {
  static title = "Inference";
  static desc = "Generates LLM response (inference for LLM use cases)";
  static title_color = "#f7768e";

  constructor() {
    super();
    this.title = "Inference";
    this.addInput("query", "string");
    this.addInput("model", "object");
    this.addInput("context", "object"); // Input from Memory Adapter
    this.addOutput("response", "string");
    this.addProperty("quantum_influence", 0.7, "number");
    this.addProperty("max_length", 1024, "number");
    this.size = [200, 120];
    (this as any).type = "inference";
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
    const context = this.getInputData(2); // Get context from Memory Adapter
    const quantumInfluence = (this.properties as any)?.quantum_influence ?? 0.7;
    const maxLength = (this.properties as any)?.max_length ?? 1024;

    // In a real implementation, this would call the LLM with memory context
    // For now, we just pass through a placeholder
    const response = `[Inference: query="${query}", quantum=${quantumInfluence}, max_len=${maxLength}]`;
    this.setOutputData(0, response);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    
    // Execution highlighting (like ComfyUI)
    const isExecuting = (this as any).executing;
    const hasExecuted = (this as any).executed;
    
    if (isExecuting) {
      // Highlight with pulsing yellow/orange when executing
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
      // Add animated border
      ctx.strokeStyle = "#ffc800";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    } else if (hasExecuted) {
      // Subtle green tint when completed
      ctx.fillStyle = "rgba(0, 255, 0, 0.1)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else {
      // Normal background
      ctx.fillStyle = "rgba(247, 118, 142, 0.1)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("inference", InferenceNode);
}

export default InferenceNode;
