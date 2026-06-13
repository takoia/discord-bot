/**
 * Minimal structured logger. Keeps demo output readable while still emitting
 * machine-parseable context. No dependency to keep the footprint small.
 */
type Level = "debug" | "info" | "warn" | "error";

const COLORS: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const time = new Date().toISOString();
  const ctxStr = ctx && Object.keys(ctx).length ? " " + JSON.stringify(ctx) : "";
  const line = `${COLORS[level]}${time} ${level.toUpperCase().padEnd(5)}${RESET} ${msg}${ctxStr}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
