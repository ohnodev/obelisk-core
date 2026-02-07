/**
 * SchedulerNode – fires a trigger output on a configurable interval.
 * Mirrors Python src/core/execution/nodes/scheduler.py
 *
 * In the tick-based WorkflowRunner, the scheduler checks elapsed time since
 * its last fire and emits `trigger: true` when the interval has passed.
 *
 * Fire timestamps are kept in a static map keyed by workflowId:nodeId so
 * state survives across ticks (the engine creates fresh instances each tick)
 * but can be explicitly cleared when a workflow starts or stops.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("scheduler");

export class SchedulerNode extends BaseNode {
  /**
   * Shared fire-time map.
   * Key: "workflowId:nodeId" (or just nodeId when no workflowId is available).
   */
  private static lastFireTimes: Map<string, number> = new Map();

  private fireKey(context: ExecutionContext): string {
    const wfId = context.variables._workflowId as string | undefined;
    return wfId ? `${wfId}:${this.nodeId}` : this.nodeId;
  }

  execute(context: ExecutionContext): Record<string, unknown> {
    const intervalSeconds = Number(
      this.getInputValue("interval_seconds", context, 60)
    );

    const key = this.fireKey(context);
    const now = Date.now();
    const lastFire = SchedulerNode.lastFireTimes.get(key) ?? 0;
    const elapsed = (now - lastFire) / 1000;

    if (lastFire === 0 || elapsed >= intervalSeconds) {
      SchedulerNode.lastFireTimes.set(key, now);
      logger.debug(
        `SchedulerNode ${this.nodeId}: fired (interval=${intervalSeconds}s, elapsed=${elapsed.toFixed(1)}s)`
      );
      return { trigger: true };
    }

    logger.debug(
      `SchedulerNode ${this.nodeId}: not yet (${elapsed.toFixed(1)}s / ${intervalSeconds}s)`
    );
    return { trigger: false };
  }

  /**
   * Clear fire timestamps for a specific workflow so schedulers fire
   * immediately on the next tick after a restart.
   */
  static resetWorkflow(workflowId: string): void {
    for (const key of SchedulerNode.lastFireTimes.keys()) {
      if (key.startsWith(`${workflowId}:`)) {
        SchedulerNode.lastFireTimes.delete(key);
      }
    }
    logger.debug(`SchedulerNode: reset timers for workflow ${workflowId}`);
  }

  /** Clear all fire timestamps (useful for tests). */
  static resetAll(): void {
    SchedulerNode.lastFireTimes.clear();
    logger.debug("SchedulerNode: all timers reset");
  }
}
