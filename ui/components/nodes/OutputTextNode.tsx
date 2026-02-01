"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class OutputTextNode extends LGraphNode {
  static title = "Output Text";
  static desc = "Displays the final output";
  static title_color = "#e0af68";

  constructor() {
    super();
    this.title = "Output Text";
    this.addInput("response", "string");
    
    // Add output property and textarea widget
    this.addProperty("output", "", "string");
    const initialValue = (this.properties as any)?.output || "";
    const widget = this.addWidget("textarea" as any, "output", initialValue, (value: string) => {
      this.setProperty("output", value);
    }, {
      serialize: true,
      rows: 8,
      cols: 30
    } as any);
    
    // Ensure widget value is set from property
    if (widget) {
      (widget as any).value = initialValue;
    }
    
    this.size = [300, 200]; // Increased size to fit textarea
    (this as any).type = "output_text";
    (this as any).resizable = true;
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget value when property changes
    if (name === "output") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "output");
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
    const response = this.getInputData(0);
    // Store the response for display - coerce to string
    const outputText = String(response || "");
    this.setProperty("output", outputText);
    // Update widget value
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const widget = widgets.find((w: any) => w.name === "output");
      if (widget) {
        widget.value = outputText;
      }
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(224, 175, 104, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("output_text", OutputTextNode);
}

export default OutputTextNode;
