// Values provided by apps/api/test/global-setup.ts to integration tests via `inject()`.
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    pgUrl: string;
    redisUrl: string;
  }
}
