"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TelegramMemoryCreatorNode extends LGraphNode {
  static title = "TG Memory Creator";
  static desc = "Stores Telegram messages and creates summaries per chat";
  static title_color = "#0088cc"; // Telegram blue

  constructor() {
    super();
    this.title = "TG Memory Creator";
    
    // Inputs
    this.addInput("message", "string");
    this.addInput("user_id", "string");
    this.addInput("username", "string");
    this.addInput("chat_id", "string");
    this.addInput("storage_instance", "object");
    this.addInput("model", "object");
    
    // Outputs
    this.addOutput("success", "boolean");
    this.addOutput("message_count", "number"); // Current count for this chat
    this.addOutput("summary_created", "boolean"); // True when summary was just created
    
    this.size = [300, 220];
    (this as any).type = "telegram_memory_creator";
    (this as any).resizable = true;
    
    // Properties
    this.addProperty("summarize_threshold", 50, "number");
    
    // Widget for summarize threshold - name must match property key for serialization
    const initialThreshold = (this.properties as any)?.summarize_threshold || 50;
    this.addWidget(
      "number" as any,
      "summarize_threshold",  // Must match property key exactly
      initialThreshold,
      (value: number) => {
        this.setProperty("summarize_threshold", Math.max(5, Math.round(value)));
      },
      {
        min: 5,
        max: 500,
        step: 5,
        serialize: true,
      } as any
    );
  }

  // Sync widget values from properties when loaded from JSON
  onConfigure(data: any) {
    if (data.properties?.summarize_threshold !== undefined) {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "summarize_threshold");
        if (widget) {
          widget.value = data.properties.summarize_threshold;
        }
      }
    }
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

    // Execution highlighting
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
      ctx.strokeStyle = "#ffc800";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
  
  onPropertyChanged(name: string, value: any) {
    if (name === "summarize_threshold") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "summarize_threshold");
        if (widget) {
          widget.value = value || 50;
        }
      }
    }
  }

  onExecute() {
    // Backend handles the actual storage and summarization
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("telegram_memory_creator", TelegramMemoryCreatorNode);
}

export default TelegramMemoryCreatorNode;
