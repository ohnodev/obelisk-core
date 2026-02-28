"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class DeterministicSchedulerNode extends LGraphNode {
  static title = "Deterministic Scheduler";
  static desc = "Triggers on exact time slots (anchor + interval + offset)";
  static title_color = "#8e44ad";

  constructor() {
    super();
    this.title = "Deterministic Scheduler";

    this.addInput("anchor_timestamp", "number,string");
    this.addInput("interval_seconds", "number,string");
    this.addInput("offset_seconds", "number,string");
    this.addInput("enabled", "boolean,string,number");

    this.addOutput("trigger", "boolean");
    this.addOutput("timestamp", "number");
    this.addOutput("slot_time", "number");
    this.addOutput("slot_iso", "string");
    this.addOutput("next_fire_in", "number");

    const nowSec = Math.floor(Date.now() / 1000);
    this.addProperty("anchor_timestamp", nowSec, "number");
    this.addProperty("interval_seconds", 300, "number");
    this.addProperty("offset_seconds", 0, "number");
    this.addProperty("enabled", true, "boolean");

    (this as any)._anchor_widget = this.addWidget("number" as any, "Anchor (epoch s)", nowSec, (value: number) => {
      this.setProperty("anchor_timestamp", Math.floor(value || 0));
    }, { min: 0, max: 2147483647, step: 1, serialize: true } as any);

    (this as any)._interval_widget = this.addWidget("number" as any, "Interval (s)", 300, (value: number) => {
      this.setProperty("interval_seconds", Math.max(1, Math.floor(value || 1)));
    }, { min: 1, max: 86400, step: 1, serialize: true } as any);

    (this as any)._offset_widget = this.addWidget("number" as any, "Offset (s)", 0, (value: number) => {
      this.setProperty("offset_seconds", Math.max(0, Math.floor(value || 0)));
    }, { min: 0, max: 86400, step: 1, serialize: true } as any);

    (this as any)._enabled_widget = this.addWidget("toggle" as any, "Enabled", true, (value: boolean) => {
      this.setProperty("enabled", value);
    }, { serialize: true } as any);

    this.size = [280, 225];
    (this as any).type = "deterministic_scheduler";
    (this as any).resizable = true;
  }

  private _syncWidgetsFromProperties() {
    const props = (this as any).properties ?? {};

    const anchor =
      Number(props.anchor_timestamp ?? props["Anchor (epoch s)"]) || Math.floor(Date.now() / 1000);
    const interval = Math.max(1, Number(props.interval_seconds ?? props["Interval (s)"]) || 300);
    const offset = Math.max(0, Number(props.offset_seconds ?? props["Offset (s)"]) || 0);
    const enabledRaw = props.enabled ?? props["Enabled"];
    const enabled =
      typeof enabledRaw === "boolean"
        ? enabledRaw
        : String(enabledRaw ?? "true").toLowerCase() !== "false";

    this.setProperty("anchor_timestamp", Math.floor(anchor));
    this.setProperty("interval_seconds", Math.floor(interval));
    this.setProperty("offset_seconds", Math.floor(offset));
    this.setProperty("enabled", enabled);

    if ((this as any)._anchor_widget) (this as any)._anchor_widget.value = Math.floor(anchor);
    if ((this as any)._interval_widget) (this as any)._interval_widget.value = Math.floor(interval);
    if ((this as any)._offset_widget) (this as any)._offset_widget.value = Math.floor(offset);
    if ((this as any)._enabled_widget) (this as any)._enabled_widget.value = enabled;

    if ((this as any).graph) {
      (this as any).graph.setDirtyCanvas(true, true);
    }
  }

  onAdded() {
    this._syncWidgetsFromProperties();
  }

  onConfigure(_data: any) {
    this._syncWidgetsFromProperties();
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("deterministic_scheduler", DeterministicSchedulerNode);
}

export default DeterministicSchedulerNode;
