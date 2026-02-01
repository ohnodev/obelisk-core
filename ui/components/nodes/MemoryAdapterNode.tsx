"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class MemoryAdapterNode extends LGraphNode {
  static title = "Memory Adapter";
  static desc = "Gets conversation context from memory";
  static title_color = "#d4af37";

  constructor() {
    super();
    this.addInput("user_id", "string");
    this.addInput("query", "string");
    this.addOutput("context", "object");
    this.size = [200, 80];
  }

  onExecute() {
    const userId = this.getInputData(0);
    const query = this.getInputData(1);
    // In a real implementation, this would call the memory manager
    const context = { userId, query, messages: [] };
    this.setOutputData(0, context);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(212, 175, 55, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

LiteGraph.registerNodeType("memory_adapter", MemoryAdapterNode);

export default MemoryAdapterNode;
