"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

// Compact dimensions — logic node is simple
const NODE_WIDTH = 220;
const NODE_HEIGHT = 130;

class BooleanLogicNode extends LGraphNode {
  static title = "Boolean Logic";
  static desc = "Boolean gate with value passthrough (OR, AND, NOT)";
  static title_color = "#2ecc71"; // Green for logic/utility

  constructor() {
    super();
    this.title = "Boolean Logic";

    // Inputs
    this.addInput("a", "boolean");
    this.addInput("b", "boolean");
    this.addInput("value", "*"); // Any type passthrough

    // Outputs
    this.addOutput("result", "boolean");
    this.addOutput("trigger", "boolean"); // same as result, for gating downstream (e.g. Launch Summary)
    this.addOutput("pass", "*");   // value when result=true
    this.addOutput("reject", "*"); // value when result=false

    this.size = [NODE_WIDTH, NODE_HEIGHT];
    (this as any).type = "boolean_logic";
    (this as any).resizable = true;

    // Properties
    this.addProperty("operation", "OR", "string");

    // Operation selector widget
    const initialOp = (this.properties as any)?.operation || "OR";
    this.addWidget(
      "combo" as any,
      "operation",
      initialOp,
      (value: string) => {
        this.setProperty("operation", value);
      },
      {
        values: ["OR", "AND", "NOT"],
        serialize: true,
        property: "operation",
      } as any
    );
  }

  onAdded() {
    this.size = [NODE_WIDTH, NODE_HEIGHT];
  }

  computeSize(): [number, number] {
    return [NODE_WIDTH, NODE_HEIGHT];
  }

  onConfigure(data: any) {
    if (super.onConfigure) {
      super.onConfigure(data);
    }
    const op = data.properties?.operation || (this.properties as any)?.operation || "OR";
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const widget = widgets.find((w: any) => w.name === "operation");
      if (widget) {
        widget.value = op;
      }
    }
    this.size = [NODE_WIDTH, NODE_HEIGHT];
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "operation") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "operation");
        if (widget) {
          widget.value = value || "OR";
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
    // Green tint for logic nodes
    ctx.fillStyle = "rgba(46, 204, 113, 0.08)";
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

  onExecute() {
    // Backend handles the actual logic
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("boolean_logic", BooleanLogicNode);
}

export default BooleanLogicNode;
