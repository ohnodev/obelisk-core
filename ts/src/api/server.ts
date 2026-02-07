/**
 * Express API server for Obelisk Core (TypeScript edition).
 * Mirrors Python src/api/server.py
 */
import express from "express";
import cors from "cors";
import { Config } from "../core/config";
import { createRouter } from "./routes";
import { getLogger } from "../utils/logger";

const logger = getLogger("server");

export function createApp(): express.Application {
  const app = express();

  // Middleware
  app.use(
    cors({
      origin: Config.CORS_ORIGINS,
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json({ limit: "1mb" }));

  // Request logging
  app.use((req, _res, next) => {
    const start = Date.now();
    _res.on("finish", () => {
      if (req.path !== "/health" && req.path !== "/") {
        logger.debug(
          `${req.method} ${req.path} → ${_res.statusCode} (${Date.now() - start}ms)`
        );
      }
    });
    next();
  });

  // ── Health & info ──────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      version: "0.1.0-ts",
      runtime: "typescript",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "Obelisk Core",
      version: "0.1.0-ts",
      runtime: "typescript",
      mode: Config.MODE,
      endpoints: {
        health: "/health",
        workflow_execute: "POST /api/v1/workflow/execute",
        workflow_run: "POST /api/v1/workflow/run",
        workflow_stop: "POST /api/v1/workflow/stop",
        workflow_status: "GET /api/v1/workflow/status/:id",
        workflow_running: "GET /api/v1/workflow/running",
        queue_execute: "POST /api/v1/queue/execute",
        queue_status: "GET /api/v1/queue/status/:job_id",
        queue_result: "GET /api/v1/queue/result/:job_id",
        queue_info: "GET /api/v1/queue/info",
      },
    });
  });

  // ── Mount API routes under /api/v1 (matches Python FastAPI prefix) ──
  app.use("/api/v1", createRouter());

  return app;
}

/**
 * Start the server. Called from index.ts or directly.
 */
export function startServer(): void {
  const app = createApp();

  app.listen(Config.API_PORT, Config.API_HOST, () => {
    logger.info("=".repeat(60));
    logger.info("Obelisk Core (TypeScript) starting...");
    logger.info(`  Mode:   ${Config.MODE}`);
    logger.info(`  Host:   ${Config.API_HOST}:${Config.API_PORT}`);
    logger.info(`  CORS:   ${Config.CORS_ORIGINS.join(", ")}`);
    logger.info(`  Debug:  ${Config.DEBUG}`);
    logger.info("=".repeat(60));
  });
}
