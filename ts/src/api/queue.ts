/**
 * Execution queue – serialises workflow execution requests.
 * Mirrors Python src/api/queue.py
 */
import {
  WorkflowData,
  GraphExecutionResult,
} from "../core/types";
import { ExecutionEngine } from "../core/execution/engine";
import { getLogger } from "../utils/logger";

const logger = getLogger("queue");

interface QueueItem {
  workflow: WorkflowData;
  contextVariables: Record<string, unknown>;
  resolve: (result: GraphExecutionResult) => void;
  reject: (err: Error) => void;
}

export class ExecutionQueue {
  private engine: ExecutionEngine;
  private queue: QueueItem[] = [];
  private processing = false;
  private maxSize: number;

  constructor(maxSize = 100) {
    this.engine = new ExecutionEngine();
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Submit a workflow for execution.
   * Returns a promise that resolves when execution completes.
   */
  submit(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {}
  ): Promise<GraphExecutionResult> {
    if (this.queue.length >= this.maxSize) {
      return Promise.reject(
        new Error(`Queue full (max ${this.maxSize})`)
      );
    }

    return new Promise<GraphExecutionResult>((resolve, reject) => {
      this.queue.push({ workflow, contextVariables, resolve, reject });
      logger.debug(`Queued workflow (queue size: ${this.queue.length})`);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      const result = await this.engine.execute(
        item.workflow,
        item.contextVariables
      );
      item.resolve(result);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.processing = false;
      // Process next item if any
      if (this.queue.length > 0) {
        this.processNext();
      }
    }
  }
}
