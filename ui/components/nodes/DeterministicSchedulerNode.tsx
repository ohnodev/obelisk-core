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

    this.addWidget("number" as any, "Anchor (epoch s)", nowSec, (value: number) => {
      this.setProperty("anchor_timestamp", Math.floor(value || 0));
    }, { min: 0, max: 2147483647, step: 1, serialize: true } as any);

    this.addWidget("number" as any, "Interval (s)", 300, (value: number) => {
      this.setProperty("interval_seconds", Math.max(1, Math.floor(value || 1)));
    }, { min: 1, max: 86400, step: 1, serialize: true } as any);

    this.addWidget("number" as any, "Offset (s)", 0, (value: number) => {
      this.setProperty("offset_seconds", Math.max(0, Math.floor(value || 0)));
    }, { min: 0, max: 86400, step: 1, serialize: true } as any);

    this.addWidget("toggle" as any, "Enabled", true, (value: boolean) => {
      this.setProperty("enabled", value);
    }, { serialize: true } as any);

    this.size = [280, 190];
    (this as any).type = "deterministic_scheduler";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("deterministic_scheduler", DeterministicSchedulerNode);
}

export default DeterministicSchedulerNode;
