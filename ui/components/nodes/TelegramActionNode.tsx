"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TelegramActionNode extends LGraphNode {
  static title = "TG Action";
  static desc = "Executes action list for Telegram (reply, send_dm, pin_message, timeout, delete_message)";
  static title_color = "#0088cc";

  constructor() {
    super();
    this.title = "TG Action";

    this.addInput("actions", "array");
    this.addInput("chat_id", "string");
    this.addInput("message_id", "number");
    this.addInput("user_id", "string");
    this.addInput("bot_id", "string");

    this.addOutput("success", "boolean");
    this.addOutput("results", "object");

    this.size = [260, 160];
    (this as any).type = "telegram_action";
    (this as any).resizable = true;

    this.addProperty("bot_id", "", "string");
    const initialBotId = (this.properties as any)?.bot_id || "";
    const botIdWidget = this.addWidget(
      "text" as any,
      "bot_id",
      initialBotId,
      (value: string) => {
        const inputIndex = this.inputs.findIndex((i: any) => i.name === "bot_id");
        if (inputIndex !== -1 && (this.inputs[inputIndex] as any).link) return;
        this.setProperty("bot_id", value);
      },
      { serialize: true, property: "bot_id" } as any
    );
    (this as any)._bot_id_widget = botIdWidget;
  }

  onConnectionsChange(type: number, slot: number) {
    const botIdIndex = this.inputs.findIndex((i: any) => i.name === "bot_id");
    if (slot === botIdIndex) {
      this.updateWidgetState("_bot_id_widget");
    }
  }

  updateWidgetState(widgetRef: string) {
    const inputIndex = this.inputs.findIndex((i: any) => i.name === "bot_id");
    const isConnected = inputIndex !== -1 && !!(this.inputs[inputIndex] as any).link;
    const widget = (this as any)[widgetRef];
    if (widget) {
      widget.disabled = isConnected;
      (widget as any)._connected = isConnected;
      if ((this as any).graph) (this as any).graph.setDirtyCanvas(true, true);
    }
  }

  onAdded() {
    this.updateWidgetState("_bot_id_widget");
  }

  onConfigure(data: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets && this.properties) {
      const props = this.properties as any;
      widgets.forEach((widget: any) => {
        if (widget.name === "bot_id" && props.bot_id !== undefined) {
          widget.value = props.bot_id;
        }
      });
    }
  }

  onExecute() {
    // Backend executes actions via Telegram API
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
    const w = (this as any)._bot_id_widget;
    if (w && w._connected && w.last_y !== undefined) {
      ctx.fillStyle = "rgba(0, 136, 204, 0.7)";
      ctx.fillRect(60, w.last_y, this.size[0] - 70, 20);
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.font = "10px sans-serif";
      ctx.fillText("← connected", 65, w.last_y + 14);
    }
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets && name === "bot_id") {
      const widget = widgets.find((w: any) => w.name === "bot_id");
      if (widget) widget.value = value || "";
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) return;
    ctx.fillStyle = "rgba(0, 136, 204, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
      ctx.strokeStyle = "#ffc800";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("telegram_action", TelegramActionNode);
}

export default TelegramActionNode;
