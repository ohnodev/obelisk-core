"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemoryCreatorNode extends LGraphNode {
  static title = "Memory Creator";
  static desc = "Creates memory data (interactions, summaries) - use SaveNode to save";
  static title_color = "#bb9af7";

  constructor() {
    super();
    this.title = "Memory Creator";
    this.addInput("query", "string");
    this.addInput("response", "string");
    this.addInput("user_id", "string");
    this.addInput("llm", "object"); // Optional: LLM for summarization (uses container LLM if not provided)
    this.addInput("summarize_threshold", "number");
    this.addInput("previous_interactions", "array"); // Optional: Previous interactions for summarization
    this.addOutput("interaction_data", "object"); // Always present: interaction data ready to save
    this.addOutput("summary_data", "object"); // Only present when summarization occurs
    this.size = [280, 250];
    (this as any).type = "memory_creator";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("user_id", "", "string");
    this.addProperty("summarize_threshold", 3, "number");
    this.addProperty("k", 10, "number");
    this.addProperty("cycle_id", "", "string");
    this.addProperty("quantum_seed", 0.7, "number");
    
    // Add inline widgets
    this.addWidget(
      "text" as any,
      "User ID",
      "",
      (value: string) => {
        this.setProperty("user_id", value);
      },
      {
        serialize: true,
      } as any
    );
    
    this.addWidget(
      "number" as any,
      "Summarize Threshold",
      3,
      (value: number) => {
        this.setProperty("summarize_threshold", value);
      },
      {
        serialize: true,
        min: 1,
        max: 100,
        step: 1,
      } as any
    );
    
    this.addWidget(
      "number" as any,
      "K (Buffer Size)",
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
    
    this.addWidget(
      "text" as any,
      "Cycle ID",
      "",
      (value: string) => {
        this.setProperty("cycle_id", value);
      },
      {
        serialize: true,
      } as any
    );
    
    this.addWidget(
      "number" as any,
      "Quantum Seed",
      0.7,
      (value: number) => {
        this.setProperty("quantum_seed", value);
      },
      {
        serialize: true,
        min: 0.0,
        max: 1.0,
        step: 0.1,
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
    // Memory creation is handled by backend
    // Frontend just passes through the connection
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget values when property changes
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const widget = widgets.find((w: any) => {
        if (name === "user_id") return w.name === "User ID";
        if (name === "summarize_threshold") return w.name === "Summarize Threshold";
        if (name === "k") return w.name === "K (Buffer Size)";
        if (name === "cycle_id") return w.name === "Cycle ID";
        if (name === "quantum_seed") return w.name === "Quantum Seed";
        return false;
      });
      if (widget) {
        widget.value = value;
      }
    }
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
