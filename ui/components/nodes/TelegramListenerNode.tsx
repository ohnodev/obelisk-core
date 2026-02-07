"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class TelegramListenerNode extends LGraphNode {
  static title = "Telegram Listener";
  static desc = "Listens for Telegram messages via polling (autonomous)";
  static title_color = "#0088cc"; // Telegram blue

  constructor() {
    super();
    this.title = "Telegram Listener";
    
    // No inputs - this is an autonomous listener node
    
    // Outputs
    this.addOutput("trigger", "boolean");
    this.addOutput("message", "string");
    this.addOutput("user_id", "string");
    this.addOutput("username", "string");
    this.addOutput("chat_id", "string");
    this.addOutput("is_mention", "boolean");
    this.addOutput("is_reply_to_bot", "boolean");
    
    this.size = [280, 200];
    (this as any).type = "telegram_listener";
    (this as any).resizable = true;
    
    // Add properties for configuration
    this.addProperty("bot_token", "", "string");
    this.addProperty("poll_interval", 2, "number");
    
    // Add widget for bot_token (name matches property key for serialization)
    const initialToken = (this.properties as any)?.bot_token || "";
    this.addWidget(
      "text" as any,
      "bot_token",  // Match property key exactly
      initialToken,
      (value: string) => {
        this.setProperty("bot_token", value);
      },
      {
        serialize: true,
        property: "bot_token",
      } as any
    );
    
    // Add widget for poll interval (name matches property key for serialization)
    const initialInterval = (this.properties as any)?.poll_interval || 2;
    this.addWidget(
      "number" as any,
      "poll_interval",  // Match property key exactly
      initialInterval,
      (value: number) => {
        this.setProperty("poll_interval", Math.max(1, value));
      },
      {
        min: 1,
        max: 60,
        step: 1,
        serialize: true,
        property: "poll_interval",
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

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    // Telegram-themed background
    ctx.fillStyle = "rgba(0, 136, 204, 0.08)";
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
  
  onConfigure(data: any) {
    // Sync widget values from loaded properties
    const widgets = (this as any).widgets as any[];
    if (widgets && this.properties) {
      const props = this.properties as any;
      widgets.forEach((widget: any) => {
        if (widget.name === "bot_token" && props.bot_token !== undefined) {
          widget.value = props.bot_token;
        } else if (widget.name === "poll_interval" && props.poll_interval !== undefined) {
          widget.value = props.poll_interval;
        }
      });
    }
  }

  onPropertyChanged(name: string, value: any) {
    // Sync widget values when properties change
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      // Widget names now match property keys exactly
      const widget = widgets.find((w: any) => w.name === name);
      if (widget) {
        widget.value = value ?? (name === "poll_interval" ? 2 : "");
      }
    }
  }

  onExecute() {
    // Frontend doesn't execute - backend handles polling
    // This just passes configuration through
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("telegram_listener", TelegramListenerNode);
}

export default TelegramListenerNode;
