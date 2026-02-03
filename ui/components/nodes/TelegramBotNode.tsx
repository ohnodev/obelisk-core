"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TelegramBotNode extends LGraphNode {
  static title = "Telegram Bot";
  static desc = "Sends messages to Telegram groups/channels via bot API";
  static title_color = "#0088cc";

  constructor() {
    super();
    this.title = "Telegram Bot";
    
    // Inputs: message (required), bot_id and group_id (optional - can be widget or input)
    this.addInput("message", "string");
    this.addInput("bot_id", "string");
    this.addInput("group_id", "string");
    
    // Outputs
    this.addOutput("success", "boolean");
    this.addOutput("response", "object");
    
    this.size = [300, 200];
    (this as any).type = "telegram_bot";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("bot_id", "", "string");
    this.addProperty("group_id", "", "string");
    
    // Add inline text input widgets for bot_id and group_id
    // User can either connect inputs OR use the widgets
    const initialBotId = (this.properties as any)?.bot_id || "";
    this.addWidget(
      "text" as any,
      "Bot ID",
      initialBotId,
      (value: string) => {
        const bot_id_input_index = this.inputs.findIndex((input: any) => input.name === "bot_id");
        if (bot_id_input_index !== -1) {
          const input = this.inputs[bot_id_input_index];
          const isConnected = !!(input as any).link;
          if (isConnected) {
            return; // Don't update property if input is connected
          }
        }
        this.setProperty("bot_id", value);
      },
      {
        serialize: true,
      } as any
    );
    
    const initialGroupId = (this.properties as any)?.group_id || "";
    this.addWidget(
      "text" as any,
      "Group ID",
      initialGroupId,
      (value: string) => {
        const group_id_input_index = this.inputs.findIndex((input: any) => input.name === "group_id");
        if (group_id_input_index !== -1) {
          const input = this.inputs[group_id_input_index];
          const isConnected = !!(input as any).link;
          if (isConnected) {
            return; // Don't update property if input is connected
          }
        }
        this.setProperty("group_id", value);
      },
      {
        serialize: true,
      } as any
    );
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }

  onExecute() {
    // Message is required and should come from input
    // Bot ID and Group ID can come from either input or widget
    const messageInput = this.getInputData(0); // message input
    
    // Bot ID: check input first, then widget
    const botIdInput = this.getInputData(1); // bot_id input
    const botIdWidget = (this.properties as any)?.bot_id || "";
    const botId = botIdInput !== null && botIdInput !== undefined ? String(botIdInput) : botIdWidget;
    
    // Group ID: check input first, then widget
    const groupIdInput = this.getInputData(2); // group_id input
    const groupIdWidget = (this.properties as any)?.group_id || "";
    const groupId = groupIdInput !== null && groupIdInput !== undefined ? String(groupIdInput) : groupIdWidget;
    
    // Update widget values if inputs are connected
    if (botIdInput !== null && botIdInput !== undefined) {
      this.setProperty("bot_id", String(botIdInput));
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "Bot ID");
        if (widget) {
          widget.value = String(botIdInput);
        }
      }
    }
    
    if (groupIdInput !== null && groupIdInput !== undefined) {
      this.setProperty("group_id", String(groupIdInput));
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "Group ID");
        if (widget) {
          widget.value = String(groupIdInput);
        }
      }
    }
    
    // Backend handles the actual Telegram API call
    // Frontend just passes through the values
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget values when properties change
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      if (name === "bot_id") {
        const widget = widgets.find((w: any) => w.name === "Bot ID");
        if (widget) {
          widget.value = value || "";
        }
      } else if (name === "group_id") {
        const widget = widgets.find((w: any) => w.name === "Group ID");
        if (widget) {
          widget.value = value || "";
        }
      }
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(0, 136, 204, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("telegram_bot", TelegramBotNode);
}

export default TelegramBotNode;
