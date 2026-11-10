import { Controller, Inject, Param, Req } from "@nestjs/common";
import type { ConsentPurpose } from "@suiem/shared/consent";
import {
  consentsResponse,
  meResponse,
  patchMeRequest,
  type PatchMeRequest,
  postConsentRequest,
  siweNonceRequest,
  siweNonceResponse,
  walletAccount,
  walletLinkRequest,
  walletListResponse,
} from "@suiem/shared/schemas";
import type { FastifyRequest } from "fastify";
import type { Hex } from "viem";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { type SiweChainId, SiweService } from "../auth/siwe.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { MeService } from "./me.service";

const uid = (req: FastifyRequest) => req.suiem.session!.userId;

@Controller()
export class MeController {
  constructor(
    @Inject(MeService) private readonly me: MeService,
    @Inject(SiweService) private readonly siwe: SiweService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Route({
    method: "GET",
    path: "/me",
    summary: "Current user, onboarding state and wallets",
    tags: ["me"],
    auth: "user",
    response: meResponse,
  })
  get(@Req() req: FastifyRequest) {
    return this.me.me(uid(req));
  }

  @Route({
    method: "PATCH",
    path: "/me",
    summary: "Update profile and onboarding preferences",
    tags: ["me"],
    auth: "user",
    body: patchMeRequest,
    response: meResponse,
  })
  patch(@Req() req: FastifyRequest) {
    return this.me.patch(uid(req), req.body as PatchMeRequest);
  }

  @Route({
    method: "GET",
    path: "/me/consents",
    summary: "Consent state per purpose with current policy versions",
    tags: ["me"],
    auth: "user",
    response: consentsResponse,
  })
  consents(@Req() req: FastifyRequest) {
    return this.me.consents(uid(req));
  }

  @Route({
    method: "POST",
    path: "/me/consents",
    summary: "Grant or withdraw consent (stored with policy version + timestamp)",
    tags: ["me"],
    auth: "user",
    body: postConsentRequest,
    response: consentsResponse,
    status: 201,
  })
  async recordConsent(@Req() req: FastifyRequest) {
    const body = req.body as {
      purpose: ConsentPurpose;
      action: "granted" | "withdrawn";
      policyVersion: string;
    };
    const r = await this.me.recordConsent(uid(req), body);
    await this.audit.write({
      actorType: "user",
      actorUserId: uid(req),
      action: "consent.recorded",
      outcome: "success",
      requestId: req.suiem.requestId,
      details: { purpose: body.purpose, action: body.action, policyVersion: body.policyVersion },
    });
    return r;
  }

  @Route({
    method: "POST",
    path: "/wallet/nonce",
    summary: "SIWE nonce for linking a wallet to the signed-in account",
    tags: ["wallet"],
    auth: "user",
    body: siweNonceRequest,
    response: siweNonceResponse,
  })
  walletNonce(@Req() req: FastifyRequest) {
    const { chainId } = req.body as { chainId: SiweChainId };
    return this.siwe.issueNonce(chainId, "link", uid(req));
  }

  @Route({
    method: "POST",
    path: "/wallet/link",
    summary: "Link an external wallet with a SIWE signature (custody acknowledged)",
    tags: ["wallet"],
    auth: "user",
    body: walletLinkRequest,
    response: walletAccount,
    status: 201,
  })
  async link(@Req() req: FastifyRequest) {
    const { message, signature } = req.body as { message: string; signature: Hex };
    const { address, chainId } = await this.siwe.verify(message, signature, "link", uid(req));
    const id = await this.siwe.link(uid(req), address, chainId, message);
    await this.audit.write({
      actorType: "user",
      actorUserId: uid(req),
      action: "wallet.linked",
      outcome: "success",
      requestId: req.suiem.requestId,
      details: { chainId },
    });
    const w = (await this.me.wallets(uid(req))).items.find((x) => x.id === id);
    if (!w) throw new ApiError("INTERNAL", "Wallet link not found after insert");
    return w;
  }

  @Route({
    method: "GET",
    path: "/wallet/links",
    summary: "Linked wallets",
    tags: ["wallet"],
    auth: "user",
    response: walletListResponse,
  })
  wallets(@Req() req: FastifyRequest) {
    return this.me.wallets(uid(req));
  }

  @Route({
    method: "DELETE",
    path: "/wallet/link/:id",
    summary: "Unlink a wallet",
    tags: ["wallet"],
    auth: "user",
  })
  async unlink(@Req() req: FastifyRequest, @Param("id") id: string) {
    if (!z.uuid().safeParse(id).success) throw new ApiError("NOT_FOUND", "Wallet not found");
    await this.me.unlinkWallet(uid(req), id);
    await this.audit.write({
      actorType: "user",
      actorUserId: uid(req),
      action: "wallet.unlinked",
      outcome: "success",
      requestId: req.suiem.requestId,
    });
    return { ok: true };
  }
}
