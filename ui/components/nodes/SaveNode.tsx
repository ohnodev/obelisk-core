"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class SaveNode extends LGraphNode {
  static title = "Save";
  static desc = "Saves interaction or summary data to storage";
  static title_color = "#7aa2f7";

  constructor() {
    super();
    this.title = "Save";
    this.addInput("storage_instance", "object");
    this.addInput("interaction_data", "object");
    this.addInput("summary_data", "object");
    this.addInput("data_type", "string");
    this.addInput("k", "number");
    this.addOutput("saved", "boolean");
    this.addOutput("saved_data", "object");
    this.size = [240, 180];
    (this as any).type = "save";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("data_type", "interaction", "string");
    this.addProperty("k", 10, "number");
    
    // Add inline widgets
    this.addWidget(
      "combo" as any,
      "Data Type",
      "interaction",
      (value: string) => {
        this.setProperty("data_type", value);
      },
      {
        values: ["interaction", "summary"],
        serialize: true,
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
    // Saving is handled by backend
    // Frontend just passes through the connection
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(122, 162, 247, 0.1)";
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
  LiteGraph?.registerNodeType("save", SaveNode);
}

export default SaveNode;
