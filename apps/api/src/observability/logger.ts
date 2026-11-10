import pino, { type DestinationStream, type Logger } from "pino";
import { redact } from "./redact";

export type AppLogger = Logger;

/**
 * Pino logger whose every record passes through the allowlist redactor. `destination` lets
 * tests capture output, and lets main.ts tee records to the OpenTelemetry log bridge.
 */
export function createLogger(options: {
  level: string;
  service: string;
  env: string;
  destination?: DestinationStream;
}): AppLogger {
  return pino(
    {
      level: options.level,
      base: { service: options.service, env: options.env },
      messageKey: "msg",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        log: (obj) => redact(obj) as Record<string, unknown>,
      },
      hooks: {
        // Scrub the message string too (e.g. logger.info("sent to a@b.c") never leaks).
        logMethod(args, method) {
          const scrubbed = args.map((a) => (typeof a === "string" ? (redact(a) as string) : a));
          return method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
    },
    options.destination,
  );
}
