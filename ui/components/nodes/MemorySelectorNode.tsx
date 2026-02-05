"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemorySelectorNode extends LGraphNode {
  static title = "Memory Selector";
  static desc = "Selects relevant conversation context from storage";
  static title_color = "#bb9af7";

  constructor() {
    super();
    this.title = "Memory Selector";
    this.addInput("query", "string");
    this.addInput("storage_instance", "object");
    this.addInput("model", "object"); // From ModelLoaderNode
    this.addInput("k", "number");
    // user_id input - widget will render inline with this
    this.addInput("user_id", "string");
    this.addOutput("query", "string");
    this.addOutput("context", "object");
    this.size = [240, 180];
    (this as any).type = "memory_selector";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("user_id", "", "string");
    this.addProperty("enable_recent_buffer", true, "boolean");
    this.addProperty("k", 10, "number");
    
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
    
    // Add toggle widget for enable_recent_buffer
    this.addWidget(
      "toggle" as any,
      "Recent Buffer",
      true,
      (value: boolean) => {
        this.setProperty("enable_recent_buffer", value);
      },
      { serialize: true } as any
    );
    
    // Add number widget for k
    this.addWidget(
      "number" as any,
      "Recent Conversations",
      10,
      (value: number) => {
        this.setProperty("k", value);
      },
      { serialize: true, min: 1, max: 100, step: 1 } as any
    );
  }

  onConnectionsChange(type: number, slot: number, isConnected: boolean) {
    const userIdIndex = this.inputs.findIndex((i: any) => i.name === "user_id");
    if (slot === userIdIndex) {
      this.updateUserIdWidgetState();
    }
  }

  updateUserIdWidgetState() {
    const inputIndex = this.inputs.findIndex((i: any) => i.name === "user_id");
    const isConnected = inputIndex !== -1 && !!(this.inputs[inputIndex] as any).link;
    
    const widget = (this as any)._user_id_widget;
    if (widget) {
      widget.disabled = isConnected;
      (widget as any)._connected = isConnected;
      if ((this as any).graph) {
        (this as any).graph.setDirtyCanvas(true, true);
      }
    }
  }

  onAdded() {
    this.updateUserIdWidgetState();
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }

    // Draw disabled overlay on user_id widget when connected
    const widget = (this as any)._user_id_widget;
    if (widget && widget._connected && widget.last_y !== undefined) {
      ctx.fillStyle = "rgba(60, 60, 80, 0.7)";
      ctx.fillRect(60, widget.last_y, this.size[0] - 70, 20);
      
      ctx.fillStyle = "rgba(187, 154, 247, 0.8)";
      ctx.font = "10px sans-serif";
      ctx.fillText("← connected", 65, widget.last_y + 14);
    }
  }

  onExecute() {
    // Context selection is handled by backend
  }
  
  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const widget = widgets.find((w: any) => {
        if (name === "user_id") return w.name === "user_id";
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
  LiteGraph?.registerNodeType("memory_selector", MemorySelectorNode);
}

export default MemorySelectorNode;
