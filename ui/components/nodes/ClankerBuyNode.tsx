"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerBuyNode extends LGraphNode {
  static title = "Clanker Buy";
  static desc = "Execute V4 buy. Model outputs only token_address (or name/symbol) + optional amount_wei; pool params from state (connect Blockchain Config state).";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker Buy";

    this.addInput("private_key", "string");
    this.addInput("state", "object");
    this.addInput("tg_actions", "array");
    this.addInput("token_address", "string");
    this.addInput("default_amount_eth", "string");
    this.addInput("rpc_url", "string");
    this.addInput("storage_instance", "object");
    this.addInput("rebuy_cooldown_minutes", "string");

    this.addOutput("success", "boolean");
    this.addOutput("txHash", "string");
    this.addOutput("error", "string");
    this.addOutput("result", "object");

    this.addProperty("default_amount_eth", "0.003", "string");
    this.addProperty("rpc_url", "", "string");
    this.addWidget("string", "default_amount_eth", "0.003", (value: string) => {
      this.setProperty("default_amount_eth", value);
    }, { serialize: true, name: "Default amount (ETH)" });
    this.addWidget("string", "rpc_url", "", (value: string) => {
      this.setProperty("rpc_url", value);
    }, { serialize: true });

    this.size = [280, 240];
    (this as any).type = "clanker_buy";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (!widgets) return;
    if (name === "default_amount_eth") {
      const w = widgets.find((x: any) => x.name === "default_amount_eth");
      if (w) w.value = value;
    }
    if (name === "rpc_url") {
      const w = widgets.find((x: any) => x.name === "rpc_url");
      if (w) w.value = value ?? "";
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
