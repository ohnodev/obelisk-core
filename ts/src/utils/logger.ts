/**
 * Logging utility for Obelisk Core (TypeScript edition)
 * Mirrors Python src/utils/logger.py
 */

import os from "os";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Replace home directory with ~ in paths so logs don't expose full user path. */
export function abbrevPathForLog(pathOrMessage: string): string {
  const home = os.homedir();
  if (!home || pathOrMessage.length < home.length) return pathOrMessage;
  if (pathOrMessage === home) return "~";
  if (pathOrMessage.startsWith(home + "/") || pathOrMessage.startsWith(home + "\\"))
    return "~" + pathOrMessage.slice(home.length);
  return pathOrMessage;
}

/** Recursively sanitize an object for logging: replace any string that looks like a path (home dir) with ~. */
export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return abbrevPathForLog(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeForLog(v);
    return out;
  }
  return value;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function envLogLevel(): LogLevel {
  const debug =
    process.env.OBELISK_CORE_DEBUG?.toLowerCase();
  if (debug && ["true", "1", "yes"].includes(debug)) return "DEBUG";
  return "INFO";
}

const globalLevel = envLogLevel();

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  /** Alias for warn (matches Python's logger.warning) */
  warning(msg: string): void;
  error(msg: string): void;
}

export function getLogger(name: string): Logger {
  const tag = name.includes(".") ? name.split(".").pop()! : name;
  const prefix = `obelisk_core.${tag}`;

  function log(level: LogLevel, msg: string) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[globalLevel]) return;
    const line = `[${level}] ${prefix}: ${msg}`;
    // Always use console.log so ALL output goes to stdout.
    // PM2 captures stdout/stderr separately, and using console.error/warn
    // causes WARN and ERROR messages to go to a different log file,
    // making them invisible in the main log.  Python's logging goes to
    // a single stream, so we match that behavior here.
    console.log(line);
  }

  const warnFn = (msg: string) => log("WARN", msg);

  return {
    debug: (msg: string) => log("DEBUG", msg),
    info: (msg: string) => log("INFO", msg),
    warn: warnFn,
    warning: warnFn, // alias (matches Python's logger.warning)
    error: (msg: string) => log("ERROR", msg),
  };
}
