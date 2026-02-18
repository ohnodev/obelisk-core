"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class SchedulerNode extends LGraphNode {
  static title = "Scheduler";
  static desc = "Triggers connected nodes at random intervals (autonomous execution)";
  static title_color = "#9b59b6"; // Purple for autonomy

  private _lastPulseTime: number = 0;
  private _pulseActive: boolean = false;

  constructor() {
    super();
    this.title = "Scheduler";
    
    // Inputs (optional — wire a Text node to override metadata defaults)
    this.addInput("min_seconds", "string,number");
    this.addInput("max_seconds", "string,number");

    // Outputs
    this.addOutput("trigger", "boolean");
    this.addOutput("tick_count", "number");
    this.addOutput("timestamp", "number");
    
    this.size = [220, 140];
    (this as any).type = "scheduler";
    (this as any).resizable = true;
    
    // Add properties for configuration
    this.addProperty("min_seconds", 5, "number");
    this.addProperty("max_seconds", 10, "number");
    this.addProperty("enabled", true, "boolean");
    
    // Add widgets for configuration
    this.addWidget(
      "number" as any,
      "Min Seconds",
      5,
      (value: number) => {
        const newMin = Math.max(0.1, value);
        this.setProperty("min_seconds", newMin);
        // Enforce invariant: max_seconds >= min_seconds
        const currentMax = (this.properties as any)?.max_seconds || 10;
        if (currentMax < newMin) {
          this.setProperty("max_seconds", newMin);
          // Update the max widget display
          const widgets = (this as any).widgets as any[];
          const maxWidget = widgets?.find((w: any) => w.name === "Max Seconds");
          if (maxWidget) maxWidget.value = newMin;
        }
      },
      {
        min: 0.1,
        max: 3600,
        step: 0.5,
        precision: 1,
        serialize: true,
      } as any
    );
    
    this.addWidget(
      "number" as any,
      "Max Seconds",
      10,
      (value: number) => {
        const currentMin = (this.properties as any)?.min_seconds || 5;
        // Enforce invariant: max_seconds >= min_seconds
        const newMax = Math.max(0.1, value, currentMin);
        this.setProperty("max_seconds", newMax);
      },
      {
        min: 0.1,
        max: 3600,
        step: 0.5,
        precision: 1,
        serialize: true,
      } as any
    );
    
    this.addWidget(
      "toggle" as any,
      "Enabled",
      true,
      (value: boolean) => {
        this.setProperty("enabled", value);
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
    
    // Draw pulse indicator when active
    if (this._pulseActive) {
      const now = Date.now();
      const elapsed = now - this._lastPulseTime;
      const pulseDuration = 500; // 500ms pulse
      
      if (elapsed < pulseDuration) {
        const alpha = 1 - (elapsed / pulseDuration);
        ctx.fillStyle = `rgba(155, 89, 182, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(this.size[0] / 2, 20, 10 + (elapsed / pulseDuration) * 10, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this._pulseActive = false;
      }
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    
    // Purple tint for autonomous nodes
    ctx.fillStyle = "rgba(155, 89, 182, 0.1)";
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
    
    // Draw "AUTO" badge
    const enabled = (this.properties as any)?.enabled !== false;
    if (enabled) {
      ctx.fillStyle = "rgba(155, 89, 182, 0.8)";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText("AUTO", this.size[0] - 8, 18);
    }
  }

  onExecute() {
    // Frontend doesn't execute scheduler logic - it's handled by backend
    // This just passes through for display purposes
  }
  
  // Called when scheduler fires (from backend event)
  pulse() {
    this._lastPulseTime = Date.now();
    this._pulseActive = true;
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget values when properties change
    const widgets = (this as any).widgets as any[];
    if (widgets) {
      if (name === "min_seconds") {
        const widget = widgets.find((w: any) => w.name === "Min Seconds");
        if (widget) {
          widget.value = value || 5;
        }
      } else if (name === "max_seconds") {
        const widget = widgets.find((w: any) => w.name === "Max Seconds");
        if (widget) {
          widget.value = value || 10;
        }
      } else if (name === "enabled") {
        const widget = widgets.find((w: any) => w.name === "Enabled");
        if (widget) {
          widget.value = value !== false;
        }
      }
    }
  }
  
  getTitle(): string {
    const enabled = (this.properties as any)?.enabled !== false;
    const min = (this.properties as any)?.min_seconds || 5;
    const max = (this.properties as any)?.max_seconds || 10;
    return enabled ? `Scheduler (${min}-${max}s)` : "Scheduler (disabled)";
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("scheduler", SchedulerNode);
}

export default SchedulerNode;
