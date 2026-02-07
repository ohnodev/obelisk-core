/**
 * API routes for Obelisk Core.
 * Mirrors Python src/api/routes.py
 */
import { Router, Request, Response } from "express";
import { ExecutionQueue } from "./queue";
import { WorkflowRunner } from "../core/execution/runner";
import { WorkflowData } from "../core/types";
import { getLogger } from "../utils/logger";

const logger = getLogger("routes");

export function createRouter(): Router {
  const router = Router();
  const queue = new ExecutionQueue();
  const runner = new WorkflowRunner();

  // ── Execute a workflow (one-shot) ──────────────────────────────────
  router.post("/execute", async (req: Request, res: Response) => {
    try {
      const { workflow, context_variables } = req.body as {
        workflow: WorkflowData;
        context_variables?: Record<string, unknown>;
      };

      if (!workflow || !workflow.nodes) {
        res.status(400).json({ error: "workflow with nodes is required" });
        return;
      }

      // Normalize: ensure connections is always an array
      workflow.connections = workflow.connections ?? [];

      logger.info(
        `Execute request: ${workflow.nodes.length} nodes, ${workflow.connections.length} connections`
      );

      const result = await queue.submit(
        workflow,
        context_variables ?? {}
      );

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Execute failed: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ── Start a long-running workflow ──────────────────────────────────
  router.post("/workflows/start", (req: Request, res: Response) => {
    try {
      const {
        workflow,
        context_variables,
        tick_interval_ms,
      } = req.body as {
        workflow: WorkflowData;
        context_variables?: Record<string, unknown>;
        tick_interval_ms?: number;
      };

      if (!workflow || !workflow.nodes) {
        res.status(400).json({ error: "workflow with nodes is required" });
        return;
      }

      // Normalize: ensure connections is always an array
      workflow.connections = workflow.connections ?? [];

      const workflowId = runner.startWorkflow(
        workflow,
        context_variables ?? {},
        tick_interval_ms ?? 30_000
      );

      res.json({ workflow_id: workflowId, state: "running" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Stop a workflow ────────────────────────────────────────────────
  router.post("/workflows/:id/stop", (req: Request, res: Response) => {
    const success = runner.stopWorkflow(req.params.id);
    if (success) {
      res.json({ workflow_id: req.params.id, state: "stopped" });
    } else {
      res
        .status(404)
        .json({ error: `Workflow ${req.params.id} not found` });
    }
  });

  // ── Workflow status ────────────────────────────────────────────────
  router.get("/workflows/:id/status", (req: Request, res: Response) => {
    const status = runner.getStatus(req.params.id);
    if (status) {
      res.json({ workflow_id: req.params.id, ...status });
    } else {
      res
        .status(404)
        .json({ error: `Workflow ${req.params.id} not found` });
    }
  });

  // ── List active workflows ──────────────────────────────────────────
  router.get("/workflows", (_req: Request, res: Response) => {
    const workflows = runner.listWorkflows().map((id) => ({
      workflow_id: id,
      ...runner.getStatus(id),
    }));
    res.json({ workflows });
  });

  // ── Queue status ───────────────────────────────────────────────────
  router.get("/queue/status", (_req: Request, res: Response) => {
    res.json({
      queue_size: queue.size,
      is_processing: queue.isProcessing,
    });
  });

  return router;
}
