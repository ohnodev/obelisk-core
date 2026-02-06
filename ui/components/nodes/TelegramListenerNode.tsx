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
    
    // Add widget for bot_token
    const initialToken = (this.properties as any)?.bot_token || "";
    this.addWidget(
      "text" as any,
      "Bot Token",
      initialToken,
      (value: string) => {
        this.setProperty("bot_token", value);
      },
      {
        serialize: true,
      } as any
    );
    
    // Add widget for poll interval
    const initialInterval = (this.properties as any)?.poll_interval || 2;
    this.addWidget(
      "number" as any,
      "Poll Interval (s)",
      initialInterval,
      (value: number) => {
        this.setProperty("poll_interval", Math.max(1, value));
      },
      {
        min: 1,
        max: 60,
        step: 1,
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
    
    // Draw a small indicator showing this is a listener node
    ctx.fillStyle = "#0088cc";
    ctx.beginPath();
    ctx.arc(this.size[0] - 15, 15, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw "LIVE" label when in autonomous mode
    ctx.font = "bold 9px Arial";
    ctx.fillStyle = "#0088cc";
    ctx.textAlign = "right";
    ctx.fillText("LISTENER", this.size[0] - 25, 18);
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    // Telegram-themed background
    ctx.fillStyle = "rgba(0, 136, 204, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget values when properties change
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      if (name === "bot_token") {
        const widget = widgets.find((w: any) => w.name === "Bot Token");
        if (widget) {
          widget.value = value || "";
        }
      } else if (name === "poll_interval") {
        const widget = widgets.find((w: any) => w.name === "Poll Interval (s)");
        if (widget) {
          widget.value = value || 2;
        }
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
