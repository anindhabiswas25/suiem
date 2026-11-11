import { Controller, Inject, Param, Req } from "@nestjs/common";
import {
  electionListQuery,
  electionSlugParam,
  voteBindRequest,
  votePreviewRequest,
  votesCursorQuery,
} from "@suiem/shared/elections";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { LIMITS, RateLimiter } from "../infra/rate-limit";
import { ElectionsService } from "./elections.service";

const slugOf = (s: string) => {
  const p = electionSlugParam.safeParse(s);
  if (!p.success) throw new ApiError("NOT_FOUND", "Election not found");
  return p.data;
};

/**
 * $WIF elections on Robinhood Chain mainnet 4663 (real $WIF, burn-to-vote). Extension device tokens
 * get 403 DEVICE_SCOPE on every route here. No route sends a transaction: the user's own wallet does.
 */
@Controller()
export class ElectionsController {
  constructor(
    @Inject(ElectionsService) private readonly elections: ElectionsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Route({
    method: "GET",
    path: "/elections",
    summary: "Elections (mainnet · real $WIF) with candidates, indexed tallies and finality",
    tags: ["elections"],
    auth: "optional",
    query: electionListQuery,
  })
  list(@Req() req: FastifyRequest) {
    return this.elections.list((req.query as z.infer<typeof electionListQuery>).status);
  }

  @Route({
    method: "GET",
    path: "/elections/:slug",
    summary:
      "Election detail: rules, times, contract, candidates, tallies (finality, as-of block), cap, notice",
    tags: ["elections"],
    auth: "optional",
  })
  detail(@Param("slug") slug: string) {
    return this.elections.detail(slugOf(slug));
  }

  @Route({
    method: "GET",
    path: "/elections/:slug/votes",
    summary: "Indexed votes (short voter address; 'Suiem member' only per wallet_visibility)",
    tags: ["elections"],
    auth: "optional",
    query: votesCursorQuery,
  })
  votes(@Req() req: FastifyRequest, @Param("slug") slug: string) {
    const q = req.query as z.infer<typeof votesCursorQuery>;
    return this.elections.votes(slugOf(slug), req.suiem.session?.userId ?? null, q.cursor, q.limit);
  }

  @Route({
    method: "POST",
    path: "/elections/:slug/vote/preview",
    summary:
      "Vote preview: balance, allowance, remaining cap, exact approve + vote calldata (decoded), simulation, burn notice, previewHash",
    tags: ["elections"],
    auth: "user",
    body: votePreviewRequest,
  })
  async preview(@Req() req: FastifyRequest, @Param("slug") slug: string) {
    const userId = req.suiem.session!.userId;
    await this.limiter.consume(LIMITS.votePreviewsPerUser, userId);
    return this.elections.preview(
      userId,
      slugOf(slug),
      req.body as z.infer<typeof votePreviewRequest>,
    );
  }

  @Route({
    method: "POST",
    path: "/elections/:slug/votes",
    summary:
      "Bind a vote tx to your account after the receipt is verified (Idempotency-Key). Tallies come only from the indexer",
    tags: ["elections"],
    auth: "user",
    body: voteBindRequest,
    status: 201,
  })
  async bind(@Req() req: FastifyRequest, @Param("slug") slug: string) {
    const userId = req.suiem.session!.userId;
    const key = req.headers["idempotency-key"];
    const claim = await this.elections.bind(
      userId,
      slugOf(slug),
      req.body as z.infer<typeof voteBindRequest>,
      Array.isArray(key) ? key[0] : key,
    );
    await this.audit.write({
      actorType: "user",
      actorUserId: userId,
      action: "election.vote_bound",
      outcome: "success",
      targetType: "election_vote_claim",
      targetId: claim.id,
      requestId: req.suiem.requestId,
    });
    return claim;
  }

  @Route({
    method: "GET",
    path: "/me/votes",
    summary: "My bound votes with tx links and indexing finality",
    tags: ["elections"],
    auth: "user",
  })
  myVotes(@Req() req: FastifyRequest) {
    return this.elections.myVotes(req.suiem.session!.userId);
  }
}
