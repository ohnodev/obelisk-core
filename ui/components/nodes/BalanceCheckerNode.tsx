"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 120;
const DEFAULT_MIN_ETH = "0.004";

class BalanceCheckerNode extends LGraphNode {
  static title = "Balance Checker";
  static desc = "Check ETH balance for wallet; outputs has_sufficient_funds for Boolean Logic gating";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Balance Checker";

    this.addInput("private_key", "string");
    this.addInput("min_balance_wei", "string");

    this.addOutput("has_sufficient_funds", "boolean");
    this.addOutput("balance_wei", "string");
    this.addOutput("balance_eth", "number");

    this.addProperty("min_balance_wei", DEFAULT_MIN_ETH, "string");
    this.addWidget("string", "min ETH", DEFAULT_MIN_ETH, (value: string) => {
      this.setProperty("min_balance_wei", value);
    }, { serialize: true });

    this.size = [NODE_WIDTH, NODE_HEIGHT];
    (this as any).type = "balance_checker";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "min_balance_wei") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const w = widgets.find((x: any) => x.name === "min ETH");
        if (w) w.value = value ?? DEFAULT_MIN_ETH;
      }
    }
  }

  onConfigure(data: any) {
    if (super.onConfigure) super.onConfigure(data);
    const v = data.properties?.min_balance_wei ?? (this.properties as any)?.min_balance_wei ?? DEFAULT_MIN_ETH;
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      const w = widgets.find((x: any) => x.name === "min ETH");
      if (w) w.value = v;
    }
    this.size = [NODE_WIDTH, NODE_HEIGHT];
  }

  onExecute() {
    // Backend does RPC balance check
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
    ctx.fillStyle = "rgba(80, 176, 80, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("balance_checker", BalanceCheckerNode);
}

export default BalanceCheckerNode;
