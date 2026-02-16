"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class HttpResponseNode extends LGraphNode {
  static title = "HTTP Response";
  static desc = "Sends a response back to the waiting HTTP client";
  static title_color = "#e67e22"; // Orange (matching listener)

  constructor() {
    super();
    this.title = "HTTP Response";

    // Inputs
    this.addInput("response", "string");
    this.addInput("request_id", "string");
    this.addInput("status_code", "number");

    // Outputs
    this.addOutput("success", "boolean");

    this.size = [260, 120];
    (this as any).type = "http_response";
    (this as any).resizable = true;

    // Properties
    this.addProperty("status_code", 200, "number");

    // Status code widget
    const initialStatus = (this.properties as any)?.status_code || 200;
    const statusWidget = this.addWidget(
      "number" as any,
      "status_code",
      initialStatus,
      (value: number) => {
        const inputIndex = this.inputs.findIndex(
          (i: any) => i.name === "status_code"
        );
        if (inputIndex !== -1 && (this.inputs[inputIndex] as any).link) return;
        this.setProperty("status_code", Math.floor(value));
      },
      {
        min: 100,
        max: 599,
        step: 1,
        serialize: true,
        property: "status_code",
      } as any
    );
    (this as any)._status_widget = statusWidget;
  }

  onConnectionsChange(type: number, slot: number, isConnected: boolean) {
    const statusIndex = this.inputs.findIndex(
      (i: any) => i.name === "status_code"
    );
    if (slot === statusIndex) {
      this.updateWidgetState("status_code", "_status_widget");
    }
  }

  updateWidgetState(inputName: string, widgetRef: string) {
    const inputIndex = this.inputs.findIndex(
      (i: any) => i.name === inputName
    );
    const isConnected =
      inputIndex !== -1 && !!(this.inputs[inputIndex] as any).link;

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
    this.updateWidgetState("status_code", "_status_widget");
  }

  onConfigure(data: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets && this.properties) {
      const props = this.properties as any;
      widgets.forEach((widget: any) => {
        if (widget.name === "status_code" && props.status_code !== undefined) {
          widget.value = props.status_code;
        }
      });
      this.updateWidgetState("status_code", "_status_widget");
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
    if (this.flags.collapsed) return;

    // Orange-themed background
    ctx.fillStyle = "rgba(230, 126, 34, 0.08)";
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
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      if (name === "status_code") {
        const widget = widgets.find((w: any) => w.name === "status_code");
        if (widget) widget.value = value || 200;
      }
    }
  }

  onExecute() {
    // Backend handles the HTTP response
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("http_response", HttpResponseNode);
}

export default HttpResponseNode;
