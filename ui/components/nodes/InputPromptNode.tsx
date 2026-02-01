"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";
import InputIcon from "../icons/InputIcon";

class InputPromptNode extends LGraphNode {
  static title = "Input Prompt";
  static desc = "User input prompt node";
  static title_color = "#4a9eff";

  constructor() {
    super();
    this.title = "Input Prompt";
    this.addOutput("text", "string");
    this.addProperty("prompt", "", "string");
    // Use LiteGraph's textarea widget - ComfyUI style
    const initialValue = (this.properties as any)?.prompt || "";
    // LiteGraph.js supports "textarea" as a widget type
    const widget = this.addWidget("textarea" as any, "prompt", initialValue, (value: string) => {
      this.setProperty("prompt", value);
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
    (this as any).type = "input_prompt";
    (this as any).resizable = true;
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget value when property changes
    if (name === "prompt") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "prompt");
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
      ctx.lineWidth = 1.5; // Smaller, minimal border
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }

  onExecute() {
    const prompt = (this.properties as any)?.prompt || "";
    this.setOutputData(0, prompt);
  }

}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("input_prompt", InputPromptNode);
}

export default InputPromptNode;
