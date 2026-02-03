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
    this.addOutput("context", "object"); // Output to Inference node's context input
    this.size = [200, 80];
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
    
    // In a real implementation, this would retrieve context from memory
    // based on user_id and query, and return it for the Inference node
    const memory = { userId, query, messages: [] };
    this.setOutputData(0, memory);
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
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("memory_adapter", MemoryAdapterNode);
}

export default MemoryAdapterNode;
