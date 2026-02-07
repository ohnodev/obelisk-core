/**
 * Job-based execution queue for Obelisk Core.
 * Mirrors Python src/api/queue.py
 *
 * Features:
 * - Sequential job processing (one at a time)
 * - Job IDs with status tracking (queued → running → completed/failed)
 * - Per-user throttling
 * - Queue size limits
 * - Result storage for later retrieval
 * - Automatic cleanup of old completed jobs
 */
import crypto from "crypto";
import {
  WorkflowData,
  GraphExecutionResult,
} from "../core/types";
import { ExecutionEngine } from "../core/execution/engine";
import {
  convertFrontendWorkflow,
  convertBackendResults,
  extractContextVariables,
} from "./conversion";
import { getLogger } from "../utils/logger";

const logger = getLogger("queue");

// ─── Types ──────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ExecutionJob {
  id: string;
  workflow: Record<string, unknown>; // Raw frontend workflow (kept for reference)
  options: Record<string, unknown>;
  status: JobStatus;
  position: number;
  createdAt: number;   // epoch seconds
  startedAt?: number;
  completedAt?: number;
  /** Frontend-formatted results (only set when completed) */
  result?: {
    success: boolean;
    results: Record<string, { outputs: Record<string, unknown> }>;
    execution_order: string[];
    error?: string;
  };
  error?: string;
}

export class QueueFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueFullError";
  }
}

// ─── ExecutionQueue ─────────────────────────────────────────────────────

export class ExecutionQueue {
  private engine: ExecutionEngine;
  private pending: ExecutionJob[] = [];
  private jobs: Map<string, ExecutionJob> = new Map();
  private currentJob: ExecutionJob | null = null;
  private processing = false;

  /** Maximum items waiting in the queue */
  readonly maxQueueSize: number;
  /** Maximum pending/running jobs per user */
  readonly maxJobsPerUser: number;
  /** Maximum completed jobs to retain */
  readonly maxCompletedJobs: number;

  constructor(
    maxQueueSize = 20,
    maxJobsPerUser = 3,
    maxCompletedJobs = 100
  ) {
    this.engine = new ExecutionEngine();
    this.maxQueueSize = maxQueueSize;
    this.maxJobsPerUser = maxJobsPerUser;
    this.maxCompletedJobs = maxCompletedJobs;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Enqueue a workflow for execution. Returns the created job. */
  enqueue(
    workflow: Record<string, unknown>,
    options?: Record<string, unknown>
  ): ExecutionJob {
    // Check queue size limit
    if (this.pending.length >= this.maxQueueSize) {
      throw new QueueFullError(
        `Queue is full (${this.maxQueueSize} jobs). Please wait and try again.`
      );
    }

    // Check per-user limit
    const userId =
      (options?.user_id as string) ??
      (options?.client_id as string) ??
      "anonymous";
    const userPending = Array.from(this.jobs.values()).filter(
      (j) =>
        (j.status === "queued" || j.status === "running") &&
        ((j.options.user_id as string) ??
          (j.options.client_id as string) ??
          "anonymous") === userId
    ).length;

    if (userPending >= this.maxJobsPerUser) {
      throw new QueueFullError(
        `You have ${userPending} pending jobs (max ${this.maxJobsPerUser}). ` +
          `Please wait for them to complete.`
      );
    }

    const job: ExecutionJob = {
      id: crypto.randomUUID(),
      workflow,
      options: options ?? {},
      status: "queued",
      position: this.pending.length,
      createdAt: Date.now() / 1000,
    };

    this.pending.push(job);
    this.jobs.set(job.id, job);
    this.updatePositions();
    this.cleanupOldJobs();

    logger.info(
      `Enqueued job ${job.id}, position ${job.position}, user=${userId}`
    );

    // Kick off processing
    this.processNext();

    return job;
  }

  /** Get a job by ID */
  getJob(jobId: string): ExecutionJob | undefined {
    return this.jobs.get(jobId);
  }

  /** Get job status (matches Python get_status return shape) */
  getStatus(
    jobId: string
  ): Record<string, unknown> | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      job_id: job.id,
      status: job.status,
      position: job.status === "queued" ? job.position : null,
      queue_length: this.pending.length,
      created_at: job.createdAt,
      started_at: job.startedAt ?? null,
      completed_at: job.completedAt ?? null,
      has_result: job.result !== undefined,
      error: job.error ?? null,
    };
  }

  /** Get job result (only if completed/failed) */
  getResult(
    jobId: string
  ): ExecutionJob["result"] | { error: string } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    if (job.status === "completed" && job.result) return job.result;
    if (job.status === "failed") return { error: job.error ?? "Unknown error" };
    return null;
  }

  /** Cancel a queued job (cannot cancel running jobs) */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "queued") return false;

    job.status = "cancelled";
    job.completedAt = Date.now() / 1000;
    this.pending = this.pending.filter((j) => j.id !== jobId);
    this.updatePositions();

    logger.info(`Cancelled job ${jobId}`);
    return true;
  }

  /** Get overall queue info (matches Python get_queue_info) */
  getQueueInfo(): Record<string, unknown> {
    return {
      queue_length: this.pending.length,
      current_job: this.currentJob?.id ?? null,
      is_processing: this.currentJob !== null,
      total_jobs: this.jobs.size,
    };
  }

  // Convenience accessors (kept for test compatibility)
  get size(): number {
    return this.pending.length;
  }
  get isProcessing(): boolean {
    return this.processing;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private updatePositions(): void {
    for (let i = 0; i < this.pending.length; i++) {
      this.pending[i].position = i;
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.pending.length === 0) return;

    this.processing = true;
    const job = this.pending.shift()!;
    job.status = "running";
    job.startedAt = Date.now() / 1000;
    this.currentJob = job;
    this.updatePositions();

    logger.info(`Processing job ${job.id}`);

    try {
      // Convert frontend workflow → backend format
      const backendWorkflow = convertFrontendWorkflow(
        job.workflow as Record<string, unknown>
      );
      const contextVars = extractContextVariables(job.options);

      // Execute
      const engineResult: GraphExecutionResult = await this.engine.execute(
        backendWorkflow,
        contextVars
      );

      // Convert result → frontend format
      const frontendResults = convertBackendResults(engineResult);

      job.status = "completed";
      job.completedAt = Date.now() / 1000;
      job.result = {
        success: engineResult.success,
        results: frontendResults,
        execution_order: engineResult.executionOrder ?? [],
        error: engineResult.error,
      };

      logger.info(`Job ${job.id} completed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.completedAt = Date.now() / 1000;
      job.error = msg;
      logger.error(`Job ${job.id} failed: ${msg}`);
    } finally {
      this.currentJob = null;
      this.processing = false;
      // Process next
      if (this.pending.length > 0) {
        this.processNext();
      }
    }
  }

  /** Remove old completed/failed jobs to prevent unbounded growth */
  private cleanupOldJobs(): void {
    const completed = Array.from(this.jobs.values())
      .filter(
        (j) =>
          j.status === "completed" ||
          j.status === "failed" ||
          j.status === "cancelled"
      )
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    if (completed.length > this.maxCompletedJobs) {
      const toRemove = completed.slice(this.maxCompletedJobs);
      for (const j of toRemove) {
        this.jobs.delete(j.id);
      }
    }
  }
}
