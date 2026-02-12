"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

const DEFAULT_ENV = "{{process.env.SWAP_PRIVATE_KEY}}";

class WalletNode extends LGraphNode {
  static title = "Wallet";
  static desc = "Reads SWAP_PRIVATE_KEY from env; hook to Buy/Sell nodes for swap execution.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Wallet";

    this.addOutput("private_key", "string");
    this.addOutput("wallet_ready", "boolean");

    this.addProperty("private_key", DEFAULT_ENV, "string");
    this.addWidget("string", "private_key", DEFAULT_ENV, (value: string) => {
      this.setProperty("private_key", value);
    }, { serialize: true });

    this.size = [260, 80];
    (this as any).type = "wallet";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "private_key") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const w = widgets.find((x: any) => x.name === "private_key");
        if (w) w.value = value;
      }
    }
  }

  onExecute() {
    // Backend reads env / property
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
  LiteGraph?.registerNodeType("wallet", WalletNode);
}

export default WalletNode;
