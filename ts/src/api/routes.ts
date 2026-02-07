/**
 * API routes for Obelisk Core (TypeScript edition).
 * Mirrors Python src/api/routes.py – all routes are mounted under /api/v1
 * by server.ts.
 */
import { Router, Request, Response } from "express";
import { ExecutionQueue, QueueFullError } from "./queue";
import { WorkflowRunner, WorkflowLimitError } from "../core/execution/runner";
import {
  convertFrontendWorkflow,
  convertBackendResults,
  extractContextVariables,
} from "./conversion";
import { ExecutionEngine } from "../core/execution/engine";
import { getLogger } from "../utils/logger";

const logger = getLogger("routes");

export function createRouter(): Router {
  const router = Router();
  const queue = new ExecutionQueue();
  const runner = new WorkflowRunner();
  const engine = new ExecutionEngine();

  // ════════════════════════════════════════════════════════════════════
  // Workflow Execution Endpoints
  // ════════════════════════════════════════════════════════════════════

  /**
   * POST /workflow/execute
   * One-shot workflow execution (primary endpoint).
   * Accepts frontend workflow format, converts, executes, returns frontend results.
   */
  router.post("/workflow/execute", async (req: Request, res: Response) => {
    try {
      const { workflow, options } = req.body as {
        workflow: Record<string, unknown>;
        options?: Record<string, unknown>;
      };

      if (!workflow) {
        res.status(400).json({ error: "workflow is required" });
        return;
      }

      // Convert frontend → backend format
      const backendWorkflow = convertFrontendWorkflow(workflow);
      const contextVars = extractContextVariables(options);

      logger.info(
        `Execute request: ${backendWorkflow.nodes.length} nodes, ${backendWorkflow.connections.length} connections`
      );

      // Execute
      const result = await engine.execute(backendWorkflow, contextVars);

      if (result.success) {
        const frontendResults = convertBackendResults(result);
        res.json({
          execution_id: (options?.execution_id as string) ?? null,
          status: "completed",
          results: frontendResults,
          message: "Workflow executed successfully",
          execution_order: result.executionOrder ?? [],
        });
      } else {
        res.json({
          status: "error",
          error: result.error ?? "Unknown error",
          message: "Workflow execution failed",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Execute failed: ${msg}`);
      res.status(500).json({ detail: msg });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Autonomous Workflow Endpoints
  // ════════════════════════════════════════════════════════════════════

  /**
   * POST /workflow/run
   * Start continuous workflow execution (autonomous/scheduled).
   * Body: { workflow, options }
   * Returns: { workflow_id, status, message }
   *
   * Rate limits (mirrors Python):
   * - Max 5 total running workflows
   * - Max 2 running workflows per user
   */
  router.post("/workflow/run", (req: Request, res: Response) => {
    try {
      const { workflow, options } = req.body as {
        workflow: Record<string, unknown>;
        options?: Record<string, unknown>;
      };

      if (!workflow) {
        res.status(400).json({ error: "workflow is required" });
        return;
      }

      // Convert frontend → backend format
      const backendWorkflow = convertFrontendWorkflow(workflow);
      const contextVars = extractContextVariables(options);

      const workflowId = runner.startWorkflow(
        backendWorkflow,
        contextVars
      );

      res.json({
        workflow_id: workflowId,
        status: "running",
        message: `Workflow ${workflowId} started`,
      });
    } catch (err) {
      if (err instanceof WorkflowLimitError) {
        // Rate limit exceeded - return 429 Too Many Requests (matches Python)
        res.status(429).json({ detail: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Workflow run failed: ${msg}`);
      res.status(500).json({ detail: msg });
    }
  });

  /**
   * POST /workflow/stop
   * Stop a running workflow.
   * Body: { workflow_id }
   */
  router.post("/workflow/stop", (req: Request, res: Response) => {
    try {
      const { workflow_id } = req.body as { workflow_id: string };

      if (!workflow_id) {
        res.status(400).json({ error: "workflow_id is required" });
        return;
      }

      const stopped = runner.stopWorkflow(workflow_id);

      if (stopped) {
        res.json({
          workflow_id,
          status: "stopped",
          message: `Workflow ${workflow_id} stopped`,
        });
      } else {
        res.json({
          workflow_id,
          status: "not_found",
          message: `Workflow ${workflow_id} not found or not running`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ detail: msg });
    }
  });

  /**
   * GET /workflow/status/:workflow_id
   * Get workflow status with latest results and version counter.
   * Returns the exact same shape as Python WorkflowStatusResponse.
   */
  router.get("/workflow/status/:workflow_id", (req: Request, res: Response) => {
    const { workflow_id } = req.params;
    const status = runner.getStatus(workflow_id);

    if (!status) {
      res.json({
        workflow_id,
        state: "not_found",
      });
      return;
    }

    // Status already has snake_case keys from runner.getStatus()
    res.json(status);
  });

  /**
   * GET /workflow/running
   * List all running workflow IDs.
   */
  router.get("/workflow/running", (_req: Request, res: Response) => {
    const workflowIds = runner.listWorkflows();
    res.json({
      workflows: workflowIds,
      count: workflowIds.length,
    });
  });

  /**
   * POST /workflow/stop-all
   * Emergency stop for all running workflows.
   */
  router.post("/workflow/stop-all", (_req: Request, res: Response) => {
    runner.stopAll();
    res.json({ status: "stopped", message: "All workflows stopped" });
  });

  // ════════════════════════════════════════════════════════════════════
  // Execution Queue Endpoints
  // ════════════════════════════════════════════════════════════════════

  /**
   * POST /queue/execute
   * Queue a workflow for execution. Returns immediately with job_id.
   * Poll /queue/status/:job_id for progress, /queue/result/:job_id for results.
   *
   * Rate limits (mirrors Python):
   * - Max 20 jobs in queue (ExecutionQueue.MAX_QUEUE_SIZE)
   * - Max 3 pending jobs per user (ExecutionQueue.MAX_JOBS_PER_USER)
   */
  router.post("/queue/execute", (req: Request, res: Response) => {
    try {
      const { workflow, options } = req.body as {
        workflow: Record<string, unknown>;
        options?: Record<string, unknown>;
      };

      if (!workflow) {
        res.status(400).json({ error: "workflow is required" });
        return;
      }

      const job = queue.enqueue(workflow, options);

      res.json({
        job_id: job.id,
        status: job.status,
        position: job.position,
        queue_length: queue.size,
        message: `Job queued at position ${job.position}`,
      });
    } catch (err) {
      if (err instanceof QueueFullError) {
        // Rate limit exceeded - return 429 (matches Python)
        res.status(429).json({ detail: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ detail: msg });
    }
  });

  /**
   * GET /queue/status/:job_id
   * Get status of a queued job.
   */
  router.get("/queue/status/:job_id", (req: Request, res: Response) => {
    const status = queue.getStatus(req.params.job_id);

    if (!status) {
      res.status(404).json({ detail: `Job ${req.params.job_id} not found` });
      return;
    }

    res.json(status);
  });

  /**
   * GET /queue/result/:job_id
   * Get result of a completed job.
   */
  router.get("/queue/result/:job_id", (req: Request, res: Response) => {
    const job = queue.getJob(req.params.job_id);

    if (!job) {
      res.status(404).json({ detail: `Job ${req.params.job_id} not found` });
      return;
    }

    if (job.status === "queued" || job.status === "running") {
      res.json({
        job_id: job.id,
        status: job.status,
        error: "Job not yet completed",
      });
      return;
    }

    const result = queue.getResult(req.params.job_id);

    if (job.status === "completed" && result && "results" in result) {
      res.json({
        job_id: job.id,
        status: "completed",
        results: result.results,
        execution_order: result.execution_order,
      });
    } else if (job.status === "completed" && !result) {
      res.json({
        job_id: job.id,
        status: "completed",
        error: "No results available",
      });
    } else if (job.status === "failed") {
      res.json({
        job_id: job.id,
        status: "failed",
        error: job.error,
      });
    } else {
      res.json({
        job_id: job.id,
        status: job.status,
        error: "Job was cancelled",
      });
    }
  });

  /**
   * POST /queue/cancel/:job_id
   * Cancel a queued job (cannot cancel running jobs).
   */
  router.post("/queue/cancel/:job_id", (req: Request, res: Response) => {
    const cancelled = queue.cancel(req.params.job_id);

    if (cancelled) {
      res.json({ status: "cancelled", job_id: req.params.job_id });
    } else {
      const job = queue.getJob(req.params.job_id);
      if (!job) {
        res
          .status(404)
          .json({ detail: `Job ${req.params.job_id} not found` });
      } else {
        res.status(400).json({
          detail: `Cannot cancel job in status: ${job.status}`,
        });
      }
    }
  });

  /**
   * GET /queue/info
   * Get overall queue status.
   */
  router.get("/queue/info", (_req: Request, res: Response) => {
    res.json(queue.getQueueInfo());
  });

  // ════════════════════════════════════════════════════════════════════
  // Legacy / Convenience
  // ════════════════════════════════════════════════════════════════════

  /** GET /health (also available at root /health) */
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "healthy", runtime: "typescript" });
  });

  return router;
}
