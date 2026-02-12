"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerBuyNode extends LGraphNode {
  static title = "Clanker Buy";
  static desc = "Execute V4 buy (ETH → token) via CabalSwapper. Connect Wallet (private_key) and Action Router (tg_actions) or token/pool params.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker Buy";

    this.addInput("private_key", "string");
    this.addInput("tg_actions", "array");
    this.addInput("token_address", "string");
    this.addInput("amount_wei", "string");
    this.addInput("pool_fee", "number");
    this.addInput("tick_spacing", "number");
    this.addInput("hook_address", "string");

    this.addOutput("success", "boolean");
    this.addOutput("txHash", "string");
    this.addOutput("error", "string");

    this.addProperty("amount_wei", "0", "string");
    this.addWidget("string", "amount_wei", "0", (value: string) => {
      this.setProperty("amount_wei", value);
    }, { serialize: true });

    this.size = [280, 140];
    (this as any).type = "clanker_buy";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "amount_wei") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const w = widgets.find((x: any) => x.name === "amount_wei");
        if (w) w.value = value;
      }
    }
  }

  onExecute() {
    // Backend runs swap
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
  LiteGraph?.registerNodeType("clanker_buy", ClankerBuyNode);
}

export default ClankerBuyNode;
