"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TextNode extends LGraphNode {
  static title = "Text";
  static desc = "Text input/output node with textarea";
  static title_color = "#4a9eff";

  constructor() {
    super();
    this.title = "Text";
    
    // Add both input and output - flexible usage
    this.addInput("text", "string");
    this.addOutput("text", "string");
    
    // Add textarea widget for text content
    this.addProperty("text", "", "string");
    const initialValue = (this.properties as any)?.text || "";
    const widget = this.addWidget("textarea" as any, "text", initialValue, (value: string) => {
      this.setProperty("text", value);
    }, {
      serialize: true,
      rows: 8,
      cols: 30
    } as any);
    
    // Ensure widget value is set
    if (widget) {
      (widget as any).value = initialValue;
    }
    
    this.size = [300, 200];
    (this as any).type = "text";
    (this as any).resizable = true;
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget value when property changes
    if (name === "text") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "text");
        if (widget) {
          widget.value = value || "";
        }
      }
    }
  }
  
  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(74, 158, 255, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    // Draw minimal selection border
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37"; // Golden border
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }

  onExecute() {
    // Check if input is connected
    const inputData = this.getInputData(0);
    const textareaValue = (this.properties as any)?.text || "";
    
    if (inputData !== null && inputData !== undefined) {
      // Input is connected - use input value and update textarea
      const inputText = String(inputData);
      this.setProperty("text", inputText);
      // Update widget value
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "text");
        if (widget) {
          widget.value = inputText;
        }
      }
      // Output the input value
      this.setOutputData(0, inputText);
    } else {
      // Input not connected - use textarea value as output
      this.setOutputData(0, textareaValue);
    }
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph) {
  LiteGraph.registerNodeType("text", TextNode);
}

export default TextNode;
