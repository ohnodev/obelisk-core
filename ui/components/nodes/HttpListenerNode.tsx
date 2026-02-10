"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class HttpListenerNode extends LGraphNode {
  static title = "HTTP Listener";
  static desc = "Starts an HTTP server and listens for POST requests (autonomous)";
  static title_color = "#e67e22"; // Orange

  constructor() {
    super();
    this.title = "HTTP Listener";

    // No inputs — autonomous listener node

    // Outputs
    this.addOutput("trigger", "boolean");
    this.addOutput("message", "string");
    this.addOutput("user_id", "string");
    this.addOutput("request_id", "string");
    this.addOutput("method", "string");
    this.addOutput("path", "string");
    this.addOutput("headers", "string");
    this.addOutput("raw_body", "string");

    this.size = [280, 200];
    (this as any).type = "http_listener";
    (this as any).resizable = true;

    // Properties
    this.addProperty("port", 8080, "number");
    this.addProperty("path", "/api/chat", "string");

    // Port widget
    const initialPort = (this.properties as any)?.port || 8080;
    this.addWidget(
      "number" as any,
      "port",
      initialPort,
      (value: number) => {
        this.setProperty("port", Math.max(1, Math.min(65535, Math.floor(value))));
      },
      {
        min: 1,
        max: 65535,
        step: 1,
        serialize: true,
        property: "port",
      } as any
    );

    // Path widget
    const initialPath = (this.properties as any)?.path || "/api/chat";
    this.addWidget(
      "text" as any,
      "path",
      initialPath,
      (value: string) => {
        this.setProperty("path", value);
      },
      {
        serialize: true,
        property: "path",
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

  onConfigure(data: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets && this.properties) {
      const props = this.properties as any;
      widgets.forEach((widget: any) => {
        if (widget.name === "port" && props.port !== undefined) {
          widget.value = props.port;
        } else if (widget.name === "path" && props.path !== undefined) {
          widget.value = props.path;
        }
      });
    }
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const widget = widgets.find((w: any) => w.name === name);
      if (widget) {
        widget.value = value ?? (name === "port" ? 8080 : "/api/chat");
      }
    }
  }

  onExecute() {
    // Frontend doesn't execute — backend handles HTTP server
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("http_listener", HttpListenerNode);
}

export default HttpListenerNode;
