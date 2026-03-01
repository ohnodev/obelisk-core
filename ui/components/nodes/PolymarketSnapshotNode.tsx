"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketSnapshotNode extends LGraphNode {
  static title = "Polymarket Snapshot";
  static desc = "GET /api/market/snapshot from polymarket-service";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Snapshot";

    this.addInput("trigger", "boolean");
    this.addInput("base_url", "string");
    this.addOutput("success", "boolean");
    this.addOutput("snapshot", "object");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.addProperty("base_url", "{{process.env.POLYMARKET_SERVICE_URL}}", "string");
    (this as any)._base_url_widget = this.addWidget("string", "base_url", "{{process.env.POLYMARKET_SERVICE_URL}}", (value: string) => {
      this.setProperty("base_url", value);
    }, { serialize: true });

    this.size = [300, 120];
    (this as any).type = "polymarket_snapshot";
    (this as any).resizable = true;
  }

  private _updateWidgetState(inputName: string, widgetRef: string) {
    const idx = this.inputs.findIndex((i: any) => i.name === inputName);
    const isConnected = idx !== -1 && !!(this.inputs[idx] as any).link;
    const widget = (this as any)[widgetRef];
    if (widget) {
      widget.disabled = isConnected;
      (widget as any)._connected = isConnected;
      if ((this as any).graph) {
        (this as any).graph.setDirtyCanvas(true, true);
      }
    }
  }

  onConnectionsChange() {
    this._updateWidgetState("base_url", "_base_url_widget");
  }

  onAdded() {
    this._updateWidgetState("base_url", "_base_url_widget");
  }

  onConfigure(_data: any) {
    this._updateWidgetState("base_url", "_base_url_widget");
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_snapshot", PolymarketSnapshotNode);
}

export default PolymarketSnapshotNode;
