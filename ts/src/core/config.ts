/**
 * Configuration for Obelisk Core (TypeScript edition)
 * Mirrors Python src/core/config.py
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config();

function envBool(key: string, fallback = false): boolean {
  const val = process.env[key]?.toLowerCase();
  if (!val) return fallback;
  return ["true", "1", "yes"].includes(val);
}

function envPort(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const Config = {
  // Mode
  MODE: process.env.OBELISK_CORE_MODE || "solo",

  // API
  API_HOST: process.env.OBELISK_CORE_HOST || "0.0.0.0",
  API_PORT: envPort("OBELISK_CORE_PORT", 7779),

  // Storage (in project folder, not home dir)
  STORAGE_PATH:
    process.env.OBELISK_STORAGE_PATH ||
    path.join(process.cwd(), "data"),

  // Supabase (prod mode)
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",

  // Inference service
  INFERENCE_SERVICE_URL:
    process.env.INFERENCE_SERVICE_URL || "http://localhost:7780",

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",

  // Debug
  DEBUG: envBool("OBELISK_CORE_DEBUG"),

  // CORS
  CORS_ORIGINS: (
    process.env.OBELISK_CORS_ORIGINS ||
    "https://build.theobelisk.ai,http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  /** Validate configuration for the current mode */
  validate(): boolean {
    if (!Number.isInteger(this.API_PORT) || this.API_PORT <= 0) {
      console.error(
        `[Config] API_PORT must be a positive integer, got: ${this.API_PORT}`
      );
      return false;
    }
    if (this.MODE === "prod") {
      if (!this.SUPABASE_URL || !this.SUPABASE_KEY) {
        console.error(
          "[Config] prod mode requires SUPABASE_URL and SUPABASE_KEY"
        );
        return false;
      }
    }
    return true;
  },
};

