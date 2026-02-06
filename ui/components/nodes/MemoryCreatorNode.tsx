"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

// Default node dimensions
const NODE_WIDTH = 340;
const NODE_HEIGHT = 300;

class MemoryCreatorNode extends LGraphNode {
  static title = "Memory Creator";
  static desc = "Creates and persists memory data (interactions, summaries) to storage. Automatically saves interactions and generates summaries when threshold is reached.";
  static title_color = "#bb9af7";

  constructor() {
    super();
    this.title = "Memory Creator";
    this.addInput("storage_instance", "object");
    this.addInput("query", "string");
    this.addInput("response", "string");
    this.addInput("model", "object"); // From ModelLoaderNode
    this.addInput("previous_interactions", "array");
    // Inputs with linked widgets - at the end so they're closer to widget area
    this.addInput("user_id", "string");
    this.addInput("summarize_threshold", "number");
    // No outputs - saves directly to storage
    this.size = [NODE_WIDTH, NODE_HEIGHT];
    (this as any).type = "memory_creator";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("user_id", "", "string");
    this.addProperty("summarize_threshold", 3, "number");
    this.addProperty("k", 10, "number");
    this.addProperty("cycle_id", "", "string");
    this.addProperty("quantum_seed", 0.7, "number");
    
    // Add user_id widget linked to the input slot
    const user_id_widget = this.addWidget(
      "text" as any,
      "user_id",
      "",
      (value: string) => {
        const inputIndex = this.inputs.findIndex((i: any) => i.name === "user_id");
        if (inputIndex !== -1 && (this.inputs[inputIndex] as any).link) return;
        this.setProperty("user_id", value);
      },
      { serialize: true, property: "user_id" } as any
    );
    (this as any)._user_id_widget = user_id_widget;
    
    // Add summarize_threshold widget linked to the input slot
    const threshold_widget = this.addWidget(
      "number" as any,
      "summarize_threshold",
      3,
      (value: number) => {
        const inputIndex = this.inputs.findIndex((i: any) => i.name === "summarize_threshold");
        if (inputIndex !== -1 && (this.inputs[inputIndex] as any).link) return;
        this.setProperty("summarize_threshold", value);
      },
      { serialize: true, min: 1, max: 100, step: 1, property: "summarize_threshold" } as any
    );
    (this as any)._threshold_widget = threshold_widget;
    
    this.addWidget(
      "number" as any,
      "K (Buffer Size)",
      10,
      (value: number) => {
        this.setProperty("k", value);
      },
      { serialize: true, min: 1, max: 100, step: 1 } as any
    );
    
    this.addWidget(
      "text" as any,
      "Cycle ID",
      "",
      (value: string) => {
        this.setProperty("cycle_id", value);
      },
      { serialize: true } as any
    );
    
    this.addWidget(
      "number" as any,
      "Quantum Seed",
      0.7,
      (value: number) => {
        this.setProperty("quantum_seed", value);
      },
      { serialize: true, min: 0.0, max: 1.0, step: 0.1 } as any
    );
  }

  onConnectionsChange(type: number, slot: number, isConnected: boolean) {
    const userIdIndex = this.inputs.findIndex((i: any) => i.name === "user_id");
    const thresholdIndex = this.inputs.findIndex((i: any) => i.name === "summarize_threshold");
    
    if (slot === userIdIndex) {
      this.updateWidgetState("user_id", "_user_id_widget");
    }
    if (slot === thresholdIndex) {
      this.updateWidgetState("summarize_threshold", "_threshold_widget");
    }
  }

  updateWidgetState(inputName: string, widgetRef: string) {
    const inputIndex = this.inputs.findIndex((i: any) => i.name === inputName);
    const isConnected = inputIndex !== -1 && !!(this.inputs[inputIndex] as any).link;
    
    const widget = (this as any)[widgetRef];
    if (widget) {
      widget.disabled = isConnected;
      (widget as any)._connected = isConnected;
      if ((this as any).graph) {
        (this as any).graph.setDirtyCanvas(true, true);
      }
    }
  }

  onAdded() {
    this.updateWidgetState("user_id", "_user_id_widget");
    this.updateWidgetState("summarize_threshold", "_threshold_widget");
    // Force size after being added to graph (LiteGraph may auto-compute)
    this.size = [NODE_WIDTH, NODE_HEIGHT];
  }

  computeSize(): [number, number] {
    // Override LiteGraph's auto size computation
    return [NODE_WIDTH, NODE_HEIGHT];
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }

    // Draw disabled overlay on widgets when connected
    const drawConnectedOverlay = (widget: any) => {
      if (widget && widget._connected && widget.last_y !== undefined) {
        ctx.fillStyle = "rgba(60, 60, 80, 0.7)";
        ctx.fillRect(60, widget.last_y, this.size[0] - 70, 20);
        ctx.fillStyle = "rgba(187, 154, 247, 0.8)";
        ctx.font = "10px sans-serif";
        ctx.fillText("← connected", 65, widget.last_y + 14);
      }
    };

    drawConnectedOverlay((this as any)._user_id_widget);
    drawConnectedOverlay((this as any)._threshold_widget);
  }

  onExecute() {
    // Memory creation is handled by backend
  }
  
  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const widget = widgets.find((w: any) => {
        if (name === "user_id") return w.name === "user_id";
        if (name === "summarize_threshold") return w.name === "summarize_threshold";
        if (name === "k") return w.name === "K (Buffer Size)";
        if (name === "cycle_id") return w.name === "Cycle ID";
        if (name === "quantum_seed") return w.name === "Quantum Seed";
        return false;
      });
      if (widget) widget.value = value;
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) return;
    ctx.fillStyle = "rgba(187, 154, 247, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    
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
