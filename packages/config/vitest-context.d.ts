// Values provided by apps/api/test/global-setup.ts to integration tests via `inject()`.
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Schema owner (migrations/seed). */
    pgUrl: string;
    /** Least-privilege API role. */
    pgAppUrl: string;
    redisUrl: string;
  }
}
