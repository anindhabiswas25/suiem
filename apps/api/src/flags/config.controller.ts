import { Controller, Inject, Req } from "@nestjs/common";
import { robinhoodMainnet, robinhoodTestnet } from "@suiem/config/chains";
import { stockTokenEligibility } from "@suiem/config/jurisdictions";
import { type DbHandle, schema } from "@suiem/db";
import { configResponse, stockTokenEligibilityResponse } from "@suiem/shared/schemas";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "../http/errors";
import { buildOpenApiDocument } from "../http/openapi";
import { Route } from "../http/route";
import { DB } from "../tokens";
import { FlagsService } from "./flags.service";

@Controller()
export class ConfigController {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  @Route({ method: "GET", path: "/health", summary: "Liveness", tags: ["ops"], auth: "public" })
  health() {
    return { ok: true };
  }

  @Route({
    method: "GET",
    path: "/openapi.json",
    summary: "OpenAPI document generated from Zod schemas",
    tags: ["ops"],
    auth: "public",
  })
  openapi() {
    return buildOpenApiDocument();
  }

  @Route({
    method: "GET",
    path: "/config",
    summary: "Feature flags and supported chains",
    tags: ["config"],
    auth: "public",
    response: configResponse,
  })
  async config() {
    return {
      flags: await this.flags.all(),
      chains: [
        { id: robinhoodMainnet.id, name: robinhoodMainnet.name, network: "mainnet" as const },
        { id: robinhoodTestnet.id, name: robinhoodTestnet.name, network: "testnet" as const },
      ],
    };
  }

  private async jurisdictionOf(userId: string): Promise<string | null> {
    const p = (
      await this.db.db
        .select({ j: schema.userPreferences.jurisdiction })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
    )[0];
    return p?.j ?? null;
  }

  @Route({
    method: "GET",
    path: "/invest/eligibility",
    summary: "Server-side Stock Token jurisdiction check (VERIFIED_FACTS J-01)",
    tags: ["invest"],
    auth: "user",
    response: stockTokenEligibilityResponse,
  })
  async eligibility(@Req() req: FastifyRequest) {
    const e = stockTokenEligibility(await this.jurisdictionOf(req.suiem.session!.userId));
    return { ...e, network: "testnet" as const, chainId: 46630 as const };
  }

  /** Sprint 2 stub of a Stock Token route: enforces the jurisdiction gate and lists registry entries. */
  @Route({
    method: "GET",
    path: "/invest/stock-tokens",
    summary:
      "Testnet Stock Token instruments (gated by jurisdiction; addresses unverified until Sprint 5)",
    tags: ["invest"],
    auth: "user",
    response: z.object({
      items: z.array(
        z.object({
          id: z.uuid(),
          symbol: z.string(),
          displayName: z.string(),
          status: z.string(),
          network: z.literal("testnet"),
        }),
      ),
    }),
  })
  async stockTokens(@Req() req: FastifyRequest) {
    const e = stockTokenEligibility(await this.jurisdictionOf(req.suiem.session!.userId));
    if (!e.eligible) {
      throw new ApiError(
        "POLICY_DENIED",
        e.reason === "restricted_jurisdiction"
          ? "Stock Token features are not available in your jurisdiction."
          : "Declare your country in Settings to use Stock Token features.",
      );
    }
    const rows = await this.db.db
      .select()
      .from(schema.instruments)
      .where(eq(schema.instruments.legalType, "testnet_test_token"));
    return {
      items: rows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        displayName: r.displayName,
        status: r.status,
        network: "testnet" as const,
      })),
    };
  }
}
