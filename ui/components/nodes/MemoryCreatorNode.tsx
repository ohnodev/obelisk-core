"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemoryCreatorNode extends LGraphNode {
  static title = "Memory Creator";
  static desc = "Saves query/response interactions to storage";
  static title_color = "#bb9af7";

  constructor() {
    super();
    this.title = "Memory Creator";
    this.addInput("query", "string");
    this.addInput("response", "string");
    this.addInput("storage_instance", "object");
    this.addInput("user_id", "string");
    this.addInput("llm", "object");
    this.addInput("summarize_threshold", "number");
    this.addInput("k", "number");
    this.addInput("cycle_id", "string");
    this.addInput("energy", "number");
    this.addInput("quantum_seed", "number");
    this.addInput("reward_score", "number");
    this.addOutput("saved", "boolean");
    this.addOutput("summary", "object");
    this.size = [220, 180];
    (this as any).type = "memory_creator";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("user_id", "", "string");
    this.addProperty("summarize_threshold", 3, "number");
    this.addProperty("k", 10, "number");
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
    // Memory saving is handled by backend
    // Frontend just passes through the connection
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(187, 154, 247, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    
    // Execution highlighting
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.2)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("memory_creator", MemoryCreatorNode);
}

export default MemoryCreatorNode;
