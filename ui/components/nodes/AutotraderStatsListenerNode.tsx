"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class AutotraderStatsListenerNode extends LGraphNode {
  static title = "Autotrader Stats Listener";
  static desc = "GET /stats for dashboard (bags, actions). Queues requests; connect to Clanker Autotrader Stats + HTTP Response.";
  static title_color = "#3498db"; // Blue

  constructor() {
    super();
    this.title = "Autotrader Stats Listener";

    this.addOutput("trigger", "boolean");
    this.addOutput("request_id", "string");
    this.addOutput("path", "string");
    this.addOutput("method", "string");
    this.addOutput("query", "string");

    this.size = [280, 140];
    (this as any).type = "autotrader_stats_listener";
    (this as any).resizable = true;

    this.addProperty("port", 8081, "number");
    this.addProperty("path", "/stats", "string");

    this.addWidget(
      "number" as any,
      "port",
      8081,
      (value: number) => {
        this.setProperty("port", Math.max(1, Math.min(65535, Math.floor(value))));
      },
      { min: 1, max: 65535, step: 1, serialize: true, property: "port" } as any
    );
    this.addWidget(
      "text" as any,
      "path",
      "/stats",
      (value: string) => this.setProperty("path", value),
      { serialize: true, property: "path" } as any
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
    ctx.fillStyle = "rgba(52, 152, 219, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }

  onConfigure(data: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets && this.properties) {
      const props = this.properties as any;
      widgets.forEach((w: any) => {
        if (w.name === "port" && props.port !== undefined) w.value = props.port;
        else if (w.name === "path" && props.path !== undefined) w.value = props.path;
      });
    }
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const w = widgets.find((x: any) => x.name === name);
      if (w) w.value = value ?? (name === "port" ? 8081 : "/stats");
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("autotrader_stats_listener", AutotraderStatsListenerNode);
}

export default AutotraderStatsListenerNode;
