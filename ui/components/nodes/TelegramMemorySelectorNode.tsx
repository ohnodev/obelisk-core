"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TelegramMemorySelectorNode extends LGraphNode {
  static title = "TG Memory Selector";
  static desc = "Retrieves relevant context for a Telegram chat";
  static title_color = "#0088cc"; // Telegram blue

  constructor() {
    super();
    this.title = "TG Memory Selector";
    
    // Inputs
    this.addInput("message", "string"); // The incoming message to find context for
    this.addInput("chat_id", "string"); // Filter by chat
    this.addInput("storage_instance", "object");
    this.addInput("model", "object"); // For embeddings/semantic search
    
    // Outputs
    this.addOutput("context", "string"); // Combined context (summaries + recent)
    this.addOutput("recent_messages", "string"); // Just recent raw messages
    this.addOutput("summaries", "string"); // Just the summaries
    this.addOutput("message", "string"); // Original message passed through
    
    this.size = [280, 200];
    (this as any).type = "telegram_memory_selector";
    (this as any).resizable = true;
    
    // Properties
    this.addProperty("recent_count", 20, "number"); // How many recent messages to include
    this.addProperty("include_summaries", true, "boolean");
    
    // Widget for recent message count
    const initialCount = (this.properties as any)?.recent_count || 20;
    this.addWidget(
      "number" as any,
      "Recent Messages",
      initialCount,
      (value: number) => {
        this.setProperty("recent_count", Math.max(5, Math.min(100, Math.round(value))));
      },
      {
        min: 5,
        max: 100,
        step: 5,
        serialize: true,
      } as any
    );
    
    // Widget for include summaries toggle
    const initialIncludeSummaries = (this.properties as any)?.include_summaries ?? true;
    this.addWidget(
      "toggle" as any,
      "Include Summaries",
      initialIncludeSummaries,
      (value: boolean) => {
        this.setProperty("include_summaries", value);
      },
      {
        serialize: true,
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

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(0, 136, 204, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
  
  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (!widgets) return;
    
    if (name === "recent_count") {
      const widget = widgets.find((w: any) => w.name === "Recent Messages");
      if (widget) widget.value = value || 20;
    } else if (name === "include_summaries") {
      const widget = widgets.find((w: any) => w.name === "Include Summaries");
      if (widget) widget.value = value ?? true;
    }
  }

  onExecute() {
    // Backend handles the actual retrieval
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("telegram_memory_selector", TelegramMemorySelectorNode);
}

export default TelegramMemorySelectorNode;
