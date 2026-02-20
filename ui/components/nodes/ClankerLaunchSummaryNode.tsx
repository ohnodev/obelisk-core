"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerLaunchSummaryNode extends LGraphNode {
  static title = "Clanker Launch Summary";
  static desc = "Reads state from Blockchain Config; recent launches in past 1h with full stats (volume 5m/15m/30m/1h, total makers, price change) for LLM.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker Launch Summary";
    this.addInput("trigger", "boolean");
    this.addInput("state", "object");
    this.addInput("storage_instance", "object");
    this.addInput("limit", "number");
    this.addInput("window_hours", "number");
    this.addInput("max_positions", "string,number");
    this.addOutput("recent_launches", "object");
    this.addOutput("summary", "string");
    this.addOutput("text", "string");
    this.addOutput("count", "number");
    this.addOutput("has_tokens", "boolean");

    this.addProperty("window_hours", 1, "number");
    this.addProperty("limit", 5, "number");
    this.addProperty("max_positions", 3, "number");
    this.addWidget("number", "window_hours", 1, (value: number) => {
      this.setProperty("window_hours", value);
    }, { serialize: true });
    this.addWidget("number", "limit", 5, (value: number) => {
      this.setProperty("limit", value);
    }, { serialize: true });
    (this as any)._max_positions_widget = this.addWidget("number", "max_positions", 3, (value: number) => {
      this.setProperty("max_positions", value);
    }, { serialize: true });

    this.size = [320, 230];
    (this as any).type = "clanker_launch_summary";
    (this as any).resizable = true;
  }

  private _updateMaxPositionsWidgetState() {
    const idx = (this as any).inputs?.findIndex((i: any) => i.name === "max_positions");
    const isConnected = idx !== -1 && !!(this as any).inputs?.[idx]?.link;
    const widget = (this as any)._max_positions_widget;
    if (widget) {
      widget.disabled = isConnected;
      (widget as any)._connected = isConnected;
      if ((this as any).graph) {
        (this as any).graph.setDirtyCanvas(true, true);
      }
    }
  }

  onConnectionsChange() {
    this._updateMaxPositionsWidgetState();
  }

  onAdded() {
    this._updateMaxPositionsWidgetState();
  }

  onConfigure(_data: any) {
    this._updateMaxPositionsWidgetState();
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (!widgets) return;
    if (name === "window_hours") {
      const w = widgets.find((x: any) => x.name === "window_hours");
      if (w) w.value = value;
    }
    if (name === "limit") {
      const w = widgets.find((x: any) => x.name === "limit");
      if (w) w.value = value;
    }
    if (name === "max_positions") {
      const w = widgets.find((x: any) => x.name === "max_positions");
      if (w) w.value = value;
    }
  }

  onExecute() {
    // Backend reads state and builds summary
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("clanker_launch_summary", ClankerLaunchSummaryNode);
}

export default ClankerLaunchSummaryNode;
