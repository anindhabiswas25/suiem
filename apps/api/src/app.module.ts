import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import type { ApiEnv } from "@suiem/config/env";
import type { DbHandle } from "@suiem/db";
import type { Redis } from "ioredis";
import { AuditService } from "./audit/audit.service";
import { AuthController } from "./auth/auth.controller";
import { PasskeyService } from "./auth/passkey.service";
import { SessionService } from "./auth/session.service";
import { SiweService } from "./auth/siwe.service";
import { UsersService } from "./auth/users.service";
import { ConfigController } from "./flags/config.controller";
import { DevicesService } from "./extension/devices.service";
import { ExtensionController } from "./extension/extension.controller";
import { EntitiesController } from "./research/entities.controller";
import { ResearchController } from "./research/research.controller";
import { RESEARCH, type ResearchRuntime, researchRuntimeFromEnv } from "./research/runtime";
import { ThesesController } from "./research/theses.controller";
import { investRuntimeFromEnv } from "./orders/invest.runtime";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { PortfolioService } from "./orders/portfolio.service";
import { INVEST, type InvestRuntime } from "./orders/runtime";
import { WatchlistsController } from "./research/watchlists.controller";
import { FlagsService } from "./flags/flags.service";
import { ErrorEnvelopeFilter } from "./http/errors";
import { SecurityGuard } from "./http/security.guard";
import { ValidationInterceptor } from "./http/validation.interceptor";
import { RateLimiter } from "./infra/rate-limit";
import { MeController } from "./me/me.controller";
import { MeService } from "./me/me.service";
import type { AppLogger } from "./observability/logger";
import { CLOCK, type Clock, DB, ENV, LOGGER, REDIS } from "./tokens";

export interface AppDeps {
  env: ApiEnv;
  db: DbHandle;
  redis: Redis;
  logger: AppLogger;
  clock: Clock;
  /** Research providers, models, quota and queue. Defaults to env-built providers with no queue. */
  research?: ResearchRuntime;
  /** Testnet client, venue deployment, quote signer and prices. Defaults to env. */
  invest?: InvestRuntime;
}

@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const research = deps.research ?? researchRuntimeFromEnv(deps.env, deps.db, deps.redis);
    return {
      module: AppModule,
      controllers: [
        AuthController,
        MeController,
        ConfigController,
        ExtensionController,
        EntitiesController,
        ResearchController,
        WatchlistsController,
        ThesesController,
        OrdersController,
      ],
      providers: [
        { provide: ENV, useValue: deps.env },
        { provide: DB, useValue: deps.db },
        { provide: REDIS, useValue: deps.redis },
        { provide: LOGGER, useValue: deps.logger },
        { provide: CLOCK, useValue: deps.clock },
        { provide: RESEARCH, useValue: research },
        { provide: INVEST, useValue: deps.invest ?? investRuntimeFromEnv(deps.env, research) },
        OrdersService,
        PortfolioService,
        AuditService,
        RateLimiter,
        SessionService,
        UsersService,
        PasskeyService,
        SiweService,
        FlagsService,
        MeService,
        DevicesService,
        { provide: APP_GUARD, useClass: SecurityGuard },
        { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
        { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
      ],
    };
  }
}
