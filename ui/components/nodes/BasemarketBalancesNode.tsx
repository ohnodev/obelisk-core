"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BasemarketBalancesNode extends LGraphNode {
  static title = "Basemarket Balances";
  static desc = "GET /api/trade/balances?user=...&roundId=...";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Basemarket Balances";

    this.addInput("trigger", "boolean");
    this.addInput("base_url", "string");
    this.addInput("private_key", "string");
    this.addInput("user_address", "string");
    this.addInput("round_id", "string,number");
    this.addInput("current_round", "string,number");

    this.addOutput("success", "boolean");
    this.addOutput("balances", "object");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.addProperty("base_url", "{{process.env.BASEMARKET_API_URL}}", "string");
    this.addProperty("user_address", "{{process.env.BASEMARKET_USER_ADDRESS}}", "string");
    (this as any)._base_url_widget = this.addWidget("string", "base_url", "{{process.env.BASEMARKET_API_URL}}", (value: string) => {
      this.setProperty("base_url", value);
    }, { serialize: true });
    (this as any)._user_address_widget = this.addWidget("string", "user_address", "{{process.env.BASEMARKET_USER_ADDRESS}}", (value: string) => {
      this.setProperty("user_address", value);
    }, { serialize: true });

    this.size = [320, 205];
    (this as any).type = "basemarket_balances";
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
    this._updateWidgetState("user_address", "_user_address_widget");
  }

  onAdded() {
    this._updateWidgetState("base_url", "_base_url_widget");
    this._updateWidgetState("user_address", "_user_address_widget");
  }

  onConfigure(_data: any) {
    this._updateWidgetState("base_url", "_base_url_widget");
    this._updateWidgetState("user_address", "_user_address_widget");
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("basemarket_balances", BasemarketBalancesNode);
}

export default BasemarketBalancesNode;
