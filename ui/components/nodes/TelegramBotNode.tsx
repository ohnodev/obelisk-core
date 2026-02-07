"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TelegramBotNode extends LGraphNode {
  static title = "TG Send Message";
  static desc = "Sends messages to Telegram chats via bot API";
  static title_color = "#0088cc";

  constructor() {
    super();
    this.title = "TG Send Message";
    
    // Inputs: message (required), bot_id and chat_id (optional - can be widget or input)
    this.addInput("message", "string");
    this.addInput("bot_id", "string");
    this.addInput("chat_id", "string");
    
    // Outputs
    this.addOutput("success", "boolean");
    this.addOutput("response", "object");
    
    this.size = [280, 180];
    (this as any).type = "telegram_bot";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("bot_id", "", "string");
    this.addProperty("chat_id", "", "string");
    
    // Bot ID widget
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
    
    // Chat ID widget
    const initialChatId = (this.properties as any)?.chat_id || "";
    const chatIdWidget = this.addWidget(
      "text" as any,
      "chat_id",
      initialChatId,
      (value: string) => {
        const inputIndex = this.inputs.findIndex((i: any) => i.name === "chat_id");
        if (inputIndex !== -1 && (this.inputs[inputIndex] as any).link) return;
        this.setProperty("chat_id", value);
      },
      { serialize: true, property: "chat_id" } as any
    );
    (this as any)._chat_id_widget = chatIdWidget;
  }

  onConnectionsChange(type: number, slot: number, isConnected: boolean) {
    const botIdIndex = this.inputs.findIndex((i: any) => i.name === "bot_id");
    const chatIdIndex = this.inputs.findIndex((i: any) => i.name === "chat_id");
    
    if (slot === botIdIndex) {
      this.updateWidgetState("bot_id", "_bot_id_widget");
    }
    if (slot === chatIdIndex) {
      this.updateWidgetState("chat_id", "_chat_id_widget");
    }
  }

  updateWidgetState(inputName: string, widgetRef: string) {
    const inputIndex = this.inputs.findIndex((i: any) => i.name === inputName);
    const isConnected = inputIndex !== -1 && !!(this.inputs[inputIndex] as any).link;
    
    const widget = (this as any)[widgetRef];
    if (widget) {
      widget.disabled = isConnected;
      (widget as any)._connected = isConnected;
      if ((this as any).graph) {
        (this as any).graph.setDirtyCanvas(true, true);
      }
    }
  }

  onAdded() {
    this.updateWidgetState("bot_id", "_bot_id_widget");
    this.updateWidgetState("chat_id", "_chat_id_widget");
  }

  onConfigure(data: any) {
    // Sync widget values from loaded properties
    const widgets = (this as any).widgets as any[];
    if (widgets && this.properties) {
      const props = this.properties as any;
      widgets.forEach((widget: any) => {
        if (widget.name === "bot_id" && props.bot_id !== undefined) {
          widget.value = props.bot_id;
        } else if (widget.name === "chat_id" && props.chat_id !== undefined) {
          widget.value = props.chat_id;
        }
      });
    }
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }

    // Draw "← connected" overlay on widgets when connected
    const drawConnectedOverlay = (widget: any) => {
      if (widget && widget._connected && widget.last_y !== undefined) {
        ctx.fillStyle = "rgba(0, 136, 204, 0.7)";
        ctx.fillRect(60, widget.last_y, this.size[0] - 70, 20);
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.font = "10px sans-serif";
        ctx.fillText("← connected", 65, widget.last_y + 14);
      }
    };

    drawConnectedOverlay((this as any)._bot_id_widget);
    drawConnectedOverlay((this as any)._chat_id_widget);
  }

  onExecute() {
    // Backend handles the actual Telegram API call
  }
  
  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      if (name === "bot_id") {
        const widget = widgets.find((w: any) => w.name === "bot_id");
        if (widget) widget.value = value || "";
      } else if (name === "chat_id") {
        const widget = widgets.find((w: any) => w.name === "chat_id");
        if (widget) widget.value = value || "";
      }
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(0, 136, 204, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);

    // Execution highlighting
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

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("telegram_bot", TelegramBotNode);
}

export default TelegramBotNode;
