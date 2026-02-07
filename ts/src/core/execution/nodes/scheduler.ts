/**
 * SchedulerNode – fires a trigger output on a configurable interval.
 * Mirrors Python src/core/execution/nodes/scheduler.py
 *
 * In the tick-based WorkflowRunner, the scheduler checks elapsed time since
 * its last fire and emits `trigger: true` when the interval has passed.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("scheduler");

// Track last-fire timestamps per node instance (keyed by nodeId)
const lastFireTimes: Record<string, number> = {};

export class SchedulerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const intervalSeconds = Number(
      this.getInputValue("interval_seconds", context, 60)
    );

    const now = Date.now();
    const lastFire = lastFireTimes[this.nodeId] ?? 0;
    const elapsed = (now - lastFire) / 1000;

    if (lastFire === 0 || elapsed >= intervalSeconds) {
      lastFireTimes[this.nodeId] = now;
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
}
