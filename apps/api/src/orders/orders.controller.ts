import { Controller, Inject, Param, Req, Res } from "@nestjs/common";
import {
  faucetHoldingsResponse,
  orderConfirmRequest,
  orderEventsResponse,
  orderPreviewRequest,
  orderPreviewResponse,
  orderResponse,
  orderTxRequest,
  portfolioHistoryResponse,
  portfolioResponse,
  portfolioTransactionsResponse,
} from "@suiem/shared/schemas";
import { schema, type DbHandle } from "@suiem/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Hex } from "viem";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { Route } from "../http/route";
import { DB } from "../tokens";
import { OrdersService } from "./orders.service";
import { PortfolioService } from "./portfolio.service";

/**
 * Orders and portfolio (session only: a device token gets 403 DEVICE_SCOPE on every route here).
 * No route ever places an order by itself: preview → user confirmation → user-signed transaction.
 */
@Controller()
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PortfolioService) private readonly portfolio: PortfolioService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  @Route({
    method: "POST",
    path: "/orders/preview",
    summary: "Pre-trade checks, signed quote (testnet) and the exact transaction to sign",
    tags: ["orders"],
    auth: "user",
    body: orderPreviewRequest,
    response: orderPreviewResponse,
  })
  preview(@Req() req: FastifyRequest) {
    return this.orders.preview(
      req.suiem.session!.userId,
      req.body as z.infer<typeof orderPreviewRequest>,
    );
  }

  @Route({
    method: "POST",
    path: "/orders",
    summary: "Confirm a previewed order (Idempotency-Key required). Simulated orders fill at once",
    tags: ["orders"],
    auth: "user",
    body: orderConfirmRequest,
    response: orderResponse,
    status: 201,
  })
  async confirm(@Req() req: FastifyRequest) {
    const userId = req.suiem.session!.userId;
    const body = req.body as z.infer<typeof orderConfirmRequest>;
    const key = req.headers["idempotency-key"];
    const o = await this.orders.confirm(
      userId,
      { orderId: body.orderId, previewHash: body.previewHash },
      Array.isArray(key) ? key[0] : key,
    );
    await this.audit.write({
      actorType: "user",
      actorUserId: userId,
      action: "order.confirmed",
      outcome: "success",
      targetType: "order",
      targetId: o.id,
      requestId: req.suiem.requestId,
    });
    return o;
  }

  @Route({
    method: "POST",
    path: "/orders/:id/transactions",
    summary:
      "Report the tx hash; the server verifies it against the preview and reconciles from the chain",
    tags: ["orders"],
    auth: "user",
    body: orderTxRequest,
    response: orderResponse,
  })
  submit(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.orders.submitTx(
      req.suiem.session!.userId,
      id,
      (req.body as z.infer<typeof orderTxRequest>).txHash as Hex,
    );
  }

  @Route({
    method: "GET",
    path: "/orders/:id",
    summary: "Order status (reconciles submitted orders from the chain)",
    tags: ["orders"],
    auth: "user",
    response: orderResponse,
  })
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    const o = await this.orders.own(req.suiem.session!.userId, id);
    return this.orders.view(
      o.book === "testnet" || o.status === "pending" ? await this.orders.reconcile(o) : o,
    );
  }

  @Route({
    method: "GET",
    path: "/orders/:id/events",
    summary: "Order status timeline",
    tags: ["orders"],
    auth: "user",
    response: orderEventsResponse,
  })
  async events(@Req() req: FastifyRequest, @Param("id") id: string) {
    const o = await this.orders.own(req.suiem.session!.userId, id);
    const rows = await this.db.db
      .select()
      .from(schema.orderEvents)
      .where(eq(schema.orderEvents.orderId, o.id))
      .orderBy(asc(schema.orderEvents.createdAt));
    return {
      items: rows.map((r) => ({
        status: r.status,
        details: r.details as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Route({
    method: "GET",
    path: "/portfolio",
    summary: "Portfolio per book (simulated, testnet demo, faucet holdings), never summed",
    tags: ["portfolio"],
    auth: "user",
    response: portfolioResponse,
  })
  get_portfolio(@Req() req: FastifyRequest) {
    return this.portfolio.portfolio(req.suiem.session!.userId);
  }

  @Route({
    method: "GET",
    path: "/portfolio/transactions",
    summary: "Order and transaction history with explorer links",
    tags: ["portfolio"],
    auth: "user",
    response: portfolioTransactionsResponse,
  })
  async transactions(@Req() req: FastifyRequest) {
    return { items: await this.orders.list(req.suiem.session!.userId) };
  }

  @Route({
    method: "GET",
    path: "/portfolio/history",
    summary: "Value snapshots per book from fills and quotes",
    tags: ["portfolio"],
    auth: "user",
    response: portfolioHistoryResponse,
  })
  history(@Req() req: FastifyRequest) {
    return this.portfolio.history(req.suiem.session!.userId);
  }

  @Route({
    method: "GET",
    path: "/portfolio/testnet-holdings",
    summary: "Read-only balances of verified testnet faucet Stock Tokens in linked wallets",
    tags: ["portfolio"],
    auth: "user",
    response: faucetHoldingsResponse,
  })
  holdings(@Req() req: FastifyRequest) {
    return this.portfolio.faucetHoldings(req.suiem.session!.userId);
  }

  @Route({
    method: "GET",
    path: "/portfolio/export",
    summary: "Transactions as CSV",
    tags: ["portfolio"],
    auth: "user",
  })
  async export(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="suiem-transactions.csv"');
    return this.portfolio.csv(req.suiem.session!.userId);
  }
}
