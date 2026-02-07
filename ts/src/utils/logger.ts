/**
 * Logging utility for Obelisk Core (TypeScript edition)
 * Mirrors Python src/utils/logger.py
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

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
  error(msg: string): void;
}

export function getLogger(name: string): Logger {
  const tag = name.includes(".") ? name.split(".").pop()! : name;
  const prefix = `obelisk_core.${tag}`;

  function log(level: LogLevel, msg: string) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[globalLevel]) return;
    const line = `[${level}] ${prefix}: ${msg}`;
    if (level === "ERROR") {
      console.error(line);
    } else if (level === "WARN") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (msg: string) => log("DEBUG", msg),
    info: (msg: string) => log("INFO", msg),
    warn: (msg: string) => log("WARN", msg),
    error: (msg: string) => log("ERROR", msg),
  };
}
