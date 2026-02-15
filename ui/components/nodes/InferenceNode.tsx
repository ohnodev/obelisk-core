"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

// Taller to fit textarea below 4 inputs/outputs
const NODE_WIDTH = 300;
const NODE_HEIGHT = 280;

class InferenceNode extends LGraphNode {
  static title = "Inference";
  static desc = "Generates LLM response (inference for LLM use cases)";
  static title_color = "#f7768e";

  constructor() {
    super();
    this.title = "Inference";
    this.addInput("trigger", "boolean"); // When false, skip API call (e.g. insufficient funds)
    this.addInput("query", "string");
    this.addInput("model", "object");
    this.addInput("system_prompt", "string"); // Optional — can use widget instead
    this.addInput("context", "string"); // Context from Memory Selector (text)
    this.addOutput("query", "string"); // Output original query
    this.addOutput("response", "string");
    this.addProperty("quantum_influence", 0.7, "number");
    this.addProperty("max_length", 1024, "number");
    this.addProperty("system_prompt", "", "string");

    this.size = [NODE_WIDTH, NODE_HEIGHT];
    (this as any).type = "inference";
    (this as any).resizable = true;

    // Textarea widget for system_prompt — fills the node body
    // Widget name must match property/metadata key for auto-sync on load
    const initialPrompt = (this.properties as any)?.system_prompt || "";
    this.addWidget(
      "textarea" as any,
      "system_prompt", // Must match metadata key for auto-loading
      initialPrompt,
      (value: string) => {
        this.setProperty("system_prompt", value);
      },
      {
        serialize: true,
        property: "system_prompt",
      } as any
    );
  }

  onAdded() {
    // Force size after being added to graph (LiteGraph may auto-compute)
    this.size = [NODE_WIDTH, NODE_HEIGHT];
  }

  computeSize(): [number, number] {
    // Override LiteGraph's auto size computation
    return [NODE_WIDTH, NODE_HEIGHT];
  }

  onConfigure(data: any) {
    // Call parent if exists
    if (super.onConfigure) {
      super.onConfigure(data);
    }
    // Sync widget value from loaded properties (workflow-serialization already merges metadata)
    const prompt =
      data.properties?.system_prompt || (this.properties as any)?.system_prompt;
    if (prompt) {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "system_prompt");
        if (widget) {
          widget.value = prompt;
        }
      }
    }
    // Force size after configure
    this.size = [NODE_WIDTH, NODE_HEIGHT];
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "system_prompt") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "system_prompt");
        if (widget) {
          widget.value = value || "";
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

  onExecute() {
    // Backend handles the actual inference
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }

    // Execution highlighting (like ComfyUI)
    const isExecuting = (this as any).executing;
    const hasExecuted = (this as any).executed;

    if (isExecuting) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
      ctx.strokeStyle = "#ffc800";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    } else if (hasExecuted) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.1)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else {
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
