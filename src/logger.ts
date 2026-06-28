import type { LoggerLike } from "./types.js";

function formatArguments(message?: unknown, optionalParams: unknown[] = []): unknown[] {
  return [new Date(), message, ...optionalParams];
}

export const logger: LoggerLike = {
  info(message?: unknown, ...optionalParams: unknown[]): void {
    console.info(...formatArguments(message, optionalParams));
  },
  warn(message?: unknown, ...optionalParams: unknown[]): void {
    console.warn(...formatArguments(message, optionalParams));
  },
  error(message?: unknown, ...optionalParams: unknown[]): void {
    console.error(...formatArguments(message, optionalParams));
  },
};
