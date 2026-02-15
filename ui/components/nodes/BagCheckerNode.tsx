"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

const DEFAULT_SELL_TIMER_MINUTES = 5;
const DEFAULT_PROFIT_TARGET_PERCENT = 50;
const DEFAULT_STOP_LOSS_PERCENT = 20;

class BagCheckerNode extends LGraphNode {
  static title = "Bag Checker";
  static desc = "Each iteration: (1) above profit target → sell, (2) below stop loss → sell, (3) held ≥ X minutes → sell. Connected inputs override node values.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Bag Checker";

    this.addInput("trigger", "boolean");
    this.addInput("state", "object");
    this.addInput("base_path", "string");
    this.addInput("storage_instance", "object");
    this.addInput("sell_timer_minutes", "string");
    this.addInput("profit_target_percent", "string");
    this.addInput("stop_loss_percent", "string");

    this.addOutput("should_sell", "boolean");
    this.addOutput("sell_params", "object");
    this.addOutput("holding", "object");

    this.addProperty("sell_timer_minutes", DEFAULT_SELL_TIMER_MINUTES, "number");
    this.addProperty("profit_target_percent", DEFAULT_PROFIT_TARGET_PERCENT, "number");
    this.addProperty("stop_loss_percent", DEFAULT_STOP_LOSS_PERCENT, "number");
    this.addWidget(
      "number" as any,
      "Sell timer (min)",
      DEFAULT_SELL_TIMER_MINUTES,
      (value: number) => {
        const v = Math.max(0, Math.round(Number(value)) || 0);
        this.setProperty("sell_timer_minutes", v);
      },
      {
        min: 0,
        max: 120,
        step: 1,
        precision: 0,
        serialize: true,
        property: "sell_timer_minutes",
      } as any
    );
    this.addWidget(
      "number" as any,
      "Profit target %",
      DEFAULT_PROFIT_TARGET_PERCENT,
      (value: number) => {
        const v = Math.max(0, Math.round(Number(value)) || 0);
        this.setProperty("profit_target_percent", v);
      },
      {
        min: 0,
        max: 500,
        step: 5,
        precision: 0,
        serialize: true,
        property: "profit_target_percent",
      } as any
    );
    this.addWidget(
      "number" as any,
      "Stop loss %",
      DEFAULT_STOP_LOSS_PERCENT,
      (value: number) => {
        const v = Math.max(0, Math.round(Number(value)) || 0);
        this.setProperty("stop_loss_percent", v);
      },
      {
        min: 0,
        max: 100,
        step: 5,
        precision: 0,
        serialize: true,
        property: "stop_loss_percent",
      } as any
    );

    this.size = [260, 220];
    (this as any).type = "bag_checker";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (name === "sell_timer_minutes") {
      const w = widgets?.find((x: any) => x.name === "Sell timer (min)");
      if (w) w.value = value ?? DEFAULT_SELL_TIMER_MINUTES;
    } else if (name === "profit_target_percent") {
      const w = widgets?.find((x: any) => x.name === "Profit target %");
      if (w) w.value = value ?? DEFAULT_PROFIT_TARGET_PERCENT;
    } else if (name === "stop_loss_percent") {
      const w = widgets?.find((x: any) => x.name === "Stop loss %");
      if (w) w.value = value ?? DEFAULT_STOP_LOSS_PERCENT;
    }
  }

  onConfigure(data: any) {
    if (super.onConfigure) super.onConfigure(data);
    const props = data?.properties ?? (this.properties as any) ?? {};
    const widgets = (this as any).widgets as any[];
    const sellTimer = props.sell_timer_minutes ?? DEFAULT_SELL_TIMER_MINUTES;
    const profitTarget = props.profit_target_percent ?? DEFAULT_PROFIT_TARGET_PERCENT;
    const stopLoss = props.stop_loss_percent ?? DEFAULT_STOP_LOSS_PERCENT;
    const wTimer = widgets?.find((x: any) => x.name === "Sell timer (min)");
    if (wTimer) wTimer.value = Number(sellTimer);
    const wProfit = widgets?.find((x: any) => x.name === "Profit target %");
    if (wProfit) wProfit.value = Number(profitTarget);
    const wStop = widgets?.find((x: any) => x.name === "Stop loss %");
    if (wStop) wStop.value = Number(stopLoss);
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
  LiteGraph?.registerNodeType("bag_checker", BagCheckerNode);
}

export default BagCheckerNode;
