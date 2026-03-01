"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class BasemarketTradeActionNode extends LGraphNode {
  static title = "Basemarket Trade Action";
  static desc = "Signed Basemarket actions: open/close/refund/redeem/merge";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Basemarket Trade Action";

    this.addInput("trigger", "boolean");
    this.addInput("base_url", "string");
    this.addInput("private_key", "string");
    this.addInput("user_address", "string");
    this.addInput("action", "string");
    this.addInput("round_id", "string,number");
    this.addInput("current_round", "string,number");
    this.addInput("order_id", "string,number");
    this.addInput("payload", "object,string");
    this.addInput("signature", "string");

    this.addOutput("success", "boolean");
    this.addOutput("tx_hash", "string");
    this.addOutput("order_id", "string,number");
    this.addOutput("response", "object");
    this.addOutput("error", "string");

    this.addProperty("base_url", "{{process.env.BASEMARKET_API_URL}}", "string");
    this.addProperty("user_address", "{{process.env.BASEMARKET_USER_ADDRESS}}", "string");
    this.addProperty("action", "mint-complete-set", "string");
    this.addProperty("payload", {}, "object");

    (this as any)._base_url_widget = this.addWidget("string", "base_url", "{{process.env.BASEMARKET_API_URL}}", (value: string) => {
      this.setProperty("base_url", value);
    }, { serialize: true });
    (this as any)._user_address_widget = this.addWidget("string", "user_address", "{{process.env.BASEMARKET_USER_ADDRESS}}", (value: string) => {
      this.setProperty("user_address", value);
    }, { serialize: true });
    (this as any)._action_widget = this.addWidget("combo" as any, "action", "mint-complete-set", (value: string) => {
      this.setProperty("action", value);
    }, {
      values: [
        "mint-complete-set",
        "open_sell",
        "open_buy",
        "close_sell",
        "close_buy",
        "close_all_orders",
        "refund",
        "redeem",
        "merge-complete-set",
        "merge",
        "sell",
        "buy",
        "close",
      ],
      serialize: true,
    } as any);
    (this as any)._payload_widget = this.addWidget("text", "payload_json", "{}", (value: string) => {
      try {
        const parsed = JSON.parse(value || "{}");
        this.setProperty("payload", parsed);
      } catch {
        // Keep previous payload on invalid JSON
      }
    }, { serialize: true });

    this.size = [340, 310];
    (this as any).type = "basemarket_trade_action";
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
    this._updateWidgetState("action", "_action_widget");
    this._updateWidgetState("payload", "_payload_widget");
  }

  onAdded() {
    this._updateWidgetState("base_url", "_base_url_widget");
    this._updateWidgetState("user_address", "_user_address_widget");
    this._updateWidgetState("action", "_action_widget");
    this._updateWidgetState("payload", "_payload_widget");
  }

  onConfigure(_data: any) {
    this._updateWidgetState("base_url", "_base_url_widget");
    this._updateWidgetState("user_address", "_user_address_widget");
    this._updateWidgetState("action", "_action_widget");
    this._updateWidgetState("payload", "_payload_widget");
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("basemarket_trade_action", BasemarketTradeActionNode);
}

export default BasemarketTradeActionNode;
