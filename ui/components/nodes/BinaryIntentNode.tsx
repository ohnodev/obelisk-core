"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

// Default node dimensions - taller to fit textarea below 4 inputs/outputs
const NODE_WIDTH = 300;
const NODE_HEIGHT = 280;

class BinaryIntentNode extends LGraphNode {
  static title = "Binary Intent";
  static desc = "Classifies text as yes/no based on intent criteria";
  static title_color = "#e6a23c"; // Orange/amber for decision nodes

  constructor() {
    super();
    this.title = "Binary Intent";
    
    // Inputs
    this.addInput("text", "string"); // The text to evaluate
    this.addInput("intent_criteria", "string"); // What to detect (optional, can use widget)
    this.addInput("context", "string"); // Optional context
    this.addInput("model", "object"); // LLM for inference
    
    // Outputs
    this.addOutput("result", "boolean"); // true/false
    this.addOutput("pass_through", "string"); // Original text if result is true, empty if false
    this.addOutput("confidence", "string"); // "high", "medium", "low"
    this.addOutput("reasoning", "string"); // Brief explanation
    
    this.size = [NODE_WIDTH, NODE_HEIGHT];
    (this as any).type = "binary_intent";
    (this as any).resizable = true;
    
    // Properties
    this.addProperty("intent_criteria", "", "string");
    
    // Textarea widget for intent criteria - fills the node body
    // Widget name must match property/metadata key for auto-sync on load
    const initialCriteria = (this.properties as any)?.intent_criteria || "";
    this.addWidget(
      "textarea" as any,
      "intent_criteria",  // Must match metadata key for auto-loading
      initialCriteria,
      (value: string) => {
        this.setProperty("intent_criteria", value);
      },
      {
        serialize: true,
        property: "intent_criteria",
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
    const criteria = data.properties?.intent_criteria || (this.properties as any)?.intent_criteria;
    if (criteria) {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "intent_criteria");
        if (widget) {
          widget.value = criteria;
        }
      }
    }
    // Force size after configure
    this.size = [NODE_WIDTH, NODE_HEIGHT];
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
    ctx.fillStyle = "rgba(230, 162, 60, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
  
  onPropertyChanged(name: string, value: any) {
    if (name === "intent_criteria") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "intent_criteria");
        if (widget) {
          widget.value = value || "";
        }
      }
    }
  }

  onExecute() {
    // Backend handles the actual classification
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("binary_intent", BinaryIntentNode);
}

export default BinaryIntentNode;
