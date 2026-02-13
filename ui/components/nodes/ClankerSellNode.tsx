"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerSellNode extends LGraphNode {
  static title = "Clanker Sell";
  static desc = "Execute V4 sell (token → ETH) via CabalSwapper. Connect Wallet + sell_params (e.g. from Bag Checker) or token/pool params.";
  static title_color = "#c05050";

  constructor() {
    super();
    this.title = "Clanker Sell";

    this.addInput("private_key", "string");
    this.addInput("should_sell", "boolean");
    this.addInput("sell_params", "object");
    this.addInput("token_address", "string");
    this.addInput("amount_wei", "string");
    this.addInput("pool_fee", "number");
    this.addInput("tick_spacing", "number");
    this.addInput("hook_address", "string");

    this.addOutput("success", "boolean");
    this.addOutput("txHash", "string");
    this.addOutput("result", "object");

    this.size = [280, 180];
    (this as any).type = "clanker_sell";
    (this as any).resizable = true;
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("clanker_sell", ClankerSellNode);
}

export default ClankerSellNode;
