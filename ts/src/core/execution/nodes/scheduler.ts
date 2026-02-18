/**
 * SchedulerNode – autonomous node that fires a trigger at random intervals.
 * Mirrors Python src/core/execution/nodes/scheduler.py
 *
 * This is a CONTINUOUS node. The WorkflowRunner calls onTick() every ~100ms;
 * the node keeps its own timer and only fires when the random interval elapses.
 *
 * Instance state (lastFireTime, nextInterval, fireCount) lives on the node
 * object itself, which the runner keeps alive across ticks.
 */
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("scheduler");

export class SchedulerNode extends BaseNode {
  // ── CONTINUOUS execution mode ──────────────────────────────────────
  static override executionMode = ExecutionMode.CONTINUOUS;

  // ── Instance state ─────────────────────────────────────────────────
  private _minSeconds: number;
  private _maxSeconds: number;
  private _enabled: boolean;
  private _lastFireTime = 0;
  private _nextInterval: number;
  private _fireCount = 0;

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);

    const meta = this.metadata;
    let minRaw = Number(meta.min_seconds ?? meta.interval_seconds ?? 60);
    let maxRaw = Number(meta.max_seconds ?? meta.interval_seconds ?? 60);
    this._enabled = meta.enabled !== false;

    // Sanitize: fall back to sane defaults for NaN / Infinity
    if (!Number.isFinite(minRaw)) minRaw = 60;
    if (!Number.isFinite(maxRaw)) maxRaw = 60;

    this._minSeconds = minRaw;
    this._maxSeconds = maxRaw;

    if (this._minSeconds > this._maxSeconds) {
      [this._minSeconds, this._maxSeconds] = [this._maxSeconds, this._minSeconds];
    }

    this._nextInterval = this._generateInterval();

    logger.debug(
      `[Scheduler ${nodeId}] Initialized: interval=${this._minSeconds}-${this._maxSeconds}s, enabled=${this._enabled}`
    );
  }

  private _generateInterval(): number {
    return (
      Math.random() * (this._maxSeconds - this._minSeconds) + this._minSeconds
    );
  }

  // ── initialize() — called once when runner starts the workflow ──────
  override initialize(
    _workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): void {
    this._lastFireTime = Date.now() / 1000;
    this._nextInterval = this._generateInterval();
    logger.debug(
      `[Scheduler ${this.nodeId}] Initialized: first fire in ${this._nextInterval.toFixed(2)}s`
    );
  }

  // ── execute() — returns current state (no side effects) ────────────
  execute(_context: ExecutionContext): Record<string, unknown> {
    return {
      trigger: false,
      tick_count: this._fireCount,
      timestamp: this._lastFireTime,
      next_fire_in: this._nextInterval,
    };
  }

  // ── onTick() — called every ~100ms by WorkflowRunner ──────────────
  onTick(_context: ExecutionContext): Record<string, unknown> | null {
    if (!this._enabled) return null;

    // Pick up wired input values (e.g. from a Text node with process.env)
    const minInput = this.getInputValue("min_seconds", _context, undefined);
    const maxInput = this.getInputValue("max_seconds", _context, undefined);
    if (minInput != null) {
      const v = Number(minInput);
      if (Number.isFinite(v) && v > 0 && v !== this._minSeconds) {
        this._minSeconds = v;
        logger.debug(`[Scheduler ${this.nodeId}] min_seconds updated to ${v}`);
      }
    }
    if (maxInput != null) {
      const v = Number(maxInput);
      if (Number.isFinite(v) && v > 0 && v !== this._maxSeconds) {
        this._maxSeconds = v;
        logger.debug(`[Scheduler ${this.nodeId}] max_seconds updated to ${v}`);
      }
    }

    const now = Date.now() / 1000;
    const elapsed = now - this._lastFireTime;

    if (elapsed >= this._nextInterval) {
      this._fireCount++;
      this._lastFireTime = now;
      this._nextInterval = this._generateInterval();

      logger.info(
        `[Scheduler ${this.nodeId}] Fired! count=${this._fireCount}, next_in=${this._nextInterval.toFixed(2)}s`
      );

      return {
        trigger: true,
        tick_count: this._fireCount,
        timestamp: now,
        next_fire_in: this._nextInterval,
      };
    }

    return null;
  }

  // ── Helpers used by the runner ─────────────────────────────────────

  /** Clear state so the scheduler fires immediately on next tick. */
  reset(): void {
    this._lastFireTime = 0;
    this._nextInterval = this._generateInterval();
    this._fireCount = 0;
    logger.debug(`[Scheduler ${this.nodeId}] Reset`);
  }

  /**
   * @deprecated Legacy static helpers — no-ops retained for backward compatibility.
   * State lives on the node instance now; use the instance reset() method instead.
   * These do not affect runtime state and will be removed in a future version.
   */
  private static _legacyFireTimes = new Map<string, number>();

  /** @deprecated No-op. Use instance reset() instead. */
  static resetWorkflow(workflowId: string): void {
    for (const key of SchedulerNode._legacyFireTimes.keys()) {
      if (key.startsWith(`${workflowId}:`)) {
        SchedulerNode._legacyFireTimes.delete(key);
      }
    }
  }

  /** @deprecated No-op. Use instance reset() instead. */
  static resetAll(): void {
    SchedulerNode._legacyFireTimes.clear();
  }
}
