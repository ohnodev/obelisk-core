"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemoryAdapterNode extends LGraphNode {
  static title = "Memory Adapter";
  static desc = "Gets conversation context from memory";
  static title_color = "#bb9af7";

  constructor() {
    super();
    this.title = "Memory Adapter";
    this.addInput("user_id", "string");
    this.addInput("query", "string");
    this.addInput("model_response", "string"); // Input from Sampler node for memory summarization
    this.addOutput("context", "object");
    this.size = [200, 100];
    (this as any).type = "memory_adapter";
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
    const userId = this.getInputData(0);
    const query = this.getInputData(1);
    const modelResponse = this.getInputData(2); // Get model response from Sampler node
    
    // In a real implementation, this would:
    // 1. Retrieve context from memory based on user_id and query
    // 2. Store/summarize the model_response in memory for future context
    const context = { userId, query, messages: [] };
    if (modelResponse) {
      // Model response available for memory summarization
      // This would be used to update memory with the conversation
    }
    this.setOutputData(0, context);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(187, 154, 247, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph) {
  LiteGraph.registerNodeType("memory_adapter", MemoryAdapterNode);
}

export default MemoryAdapterNode;
