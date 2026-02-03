"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemorySelectorNode extends LGraphNode {
  static title = "Memory Selector";
  static desc = "Selects relevant conversation context from storage";
  static title_color = "#bb9af7";

  constructor() {
    super();
    this.title = "Memory Selector";
    this.addInput("query", "string");
    this.addInput("storage_instance", "object");
    this.addInput("user_id", "string");
    this.addInput("model", "object"); // From ModelLoaderNode
    this.addInput("llm", "object"); // Legacy/direct input
    this.addInput("enable_recent_buffer", "boolean");
    this.addInput("k", "number");
    this.addOutput("query", "string"); // Pass through original query for cleaner flow
    this.addOutput("context", "object"); // Output to Inference node's context input
    this.size = [240, 200];
    (this as any).type = "memory_selector";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("user_id", "", "string");
    this.addProperty("enable_recent_buffer", true, "boolean");
    this.addProperty("k", 10, "number");
    
    // Add toggle widget for enable_recent_buffer
    this.addWidget(
      "toggle" as any,
      "Recent Buffer",
      true,
      (value: boolean) => {
        this.setProperty("enable_recent_buffer", value);
      },
      {
        serialize: true,
      } as any
    );
    
    // Add number widget for k
    this.addWidget(
      "number" as any,
      "Recent Conversations",
      10,
      (value: number) => {
        this.setProperty("k", value);
      },
      {
        serialize: true,
        min: 1,
        max: 100,
        step: 1,
      } as any
    );
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
    // Context selection is handled by backend
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
  LiteGraph?.registerNodeType("memory_selector", MemorySelectorNode);
}

export default MemorySelectorNode;
