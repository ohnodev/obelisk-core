import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("deterministicScheduler");

function asFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

export class DeterministicSchedulerNode extends BaseNode {
  static override executionMode = ExecutionMode.CONTINUOUS;

  private _anchorTimestamp = 0;
  private _intervalSeconds = 300;
  private _offsetSeconds = 0;
  private _enabled = true;
  private _lastFiredSlotTime: number | null = null;
  private _fireCount = 0;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);
    this.loadConfigFromMetadata();
  }

  override initialize(_workflow: WorkflowData, _allNodes: Map<NodeID, BaseNode>): void {
    this._lastFiredSlotTime = null;
    this._fireCount = 0;
  }

  execute(_context: ExecutionContext): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    const { nextFireAt, nextFireIn } = this.computeNextFire(now);
    return {
      trigger: false,
      timestamp: now,
      slot_time: this._lastFiredSlotTime,
      slot_iso: this._lastFiredSlotTime ? new Date(this._lastFiredSlotTime * 1000).toISOString() : null,
      tick_count: this._fireCount,
      next_fire_at: nextFireAt,
      next_fire_in: nextFireIn,
    };
  }

  onTick(context: ExecutionContext): Record<string, unknown> | null {
    this.refreshConfigFromInputs(context);
    if (!this._enabled) return null;

    const now = Math.floor(Date.now() / 1000);
    const firstSlot = this._anchorTimestamp + this._offsetSeconds;
    if (now < firstSlot) {
      return null;
    }

    const slotIndex = Math.floor((now - firstSlot) / this._intervalSeconds);
    const slotTime = firstSlot + slotIndex * this._intervalSeconds;
    if (this._lastFiredSlotTime === slotTime) {
      return null;
    }

    this._lastFiredSlotTime = slotTime;
    this._fireCount += 1;

    const nextFireAt = slotTime + this._intervalSeconds;
    const nextFireIn = Math.max(0, nextFireAt - now);

    logger.info(
      `[DeterministicScheduler ${this.nodeId}] Fired at slot ${slotTime} (count=${this._fireCount})`
    );

    return {
      trigger: true,
      timestamp: now,
      slot_time: slotTime,
      slot_iso: new Date(slotTime * 1000).toISOString(),
      tick_count: this._fireCount,
      next_fire_at: nextFireAt,
      next_fire_in: nextFireIn,
    };
  }

  private loadConfigFromMetadata(): void {
    const now = Math.floor(Date.now() / 1000);
    const anchor = asFiniteNumber(this.resolveEnvVar(this.metadata.anchor_timestamp), now);
    const interval = asFiniteNumber(this.resolveEnvVar(this.metadata.interval_seconds), 300);
    const offset = asFiniteNumber(this.resolveEnvVar(this.metadata.offset_seconds), 0);
    const enabled = asBoolean(this.resolveEnvVar(this.metadata.enabled), true);

    this._anchorTimestamp = Math.max(0, Math.floor(anchor));
    this._intervalSeconds = Math.max(1, Math.floor(interval));
    this._offsetSeconds = Math.max(0, Math.floor(offset));
    this._enabled = enabled;
  }

  private refreshConfigFromInputs(context: ExecutionContext): void {
    const anchorInput = this.getInputValue("anchor_timestamp", context, undefined);
    const intervalInput = this.getInputValue("interval_seconds", context, undefined);
    const offsetInput = this.getInputValue("offset_seconds", context, undefined);
    const enabledInput = this.getInputValue("enabled", context, undefined);

    if (anchorInput !== undefined && anchorInput !== null) {
      this._anchorTimestamp = Math.max(0, Math.floor(asFiniteNumber(anchorInput, this._anchorTimestamp)));
    }
    if (intervalInput !== undefined && intervalInput !== null) {
      this._intervalSeconds = Math.max(1, Math.floor(asFiniteNumber(intervalInput, this._intervalSeconds)));
    }
    if (offsetInput !== undefined && offsetInput !== null) {
      this._offsetSeconds = Math.max(0, Math.floor(asFiniteNumber(offsetInput, this._offsetSeconds)));
    }
    if (enabledInput !== undefined && enabledInput !== null) {
      this._enabled = asBoolean(enabledInput, this._enabled);
    }
  }

  private computeNextFire(now: number): { nextFireAt: number; nextFireIn: number } {
    const firstSlot = this._anchorTimestamp + this._offsetSeconds;
    if (now <= firstSlot) {
      return { nextFireAt: firstSlot, nextFireIn: Math.max(0, firstSlot - now) };
    }
    const slotIndex = Math.floor((now - firstSlot) / this._intervalSeconds) + 1;
    const nextFireAt = firstSlot + slotIndex * this._intervalSeconds;
    return { nextFireAt, nextFireIn: Math.max(0, nextFireAt - now) };
  }
}
