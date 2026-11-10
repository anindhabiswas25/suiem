// Values provided by apps/api/test/global-setup.ts to integration tests via `inject()`.
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    pgOwnerUrl: string;
    pgAppUrl: string;
    pgSystemUrl: string;
    redisUrl: string;
  }
}
