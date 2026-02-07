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
