import { Inject, Injectable } from "@nestjs/common";
import { stockTokenEligibility } from "@suiem/config/jurisdictions";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { BOOK_LABELS, explorerAddress, explorerTx } from "@suiem/shared/invest";
import type {
  orderPreviewRequest,
  orderPreviewResponse,
  orderResponse,
} from "@suiem/shared/schemas";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { type Address, getAddress, type Hex } from "viem";
import type { z } from "zod";
import { FlagsService } from "../flags/flags.service";
import { ApiError } from "../http/errors";
import { bookIs } from "./sql";
import { CLOCK, type Clock, DB } from "../tokens";
import {
  applyFill,
  type Fill,
  fromUnits,
  priceToUnits,
  QTY_DECIMALS,
  toUnits,
  USD_DECIMALS,
} from "./math";
import { INVEST, type InvestRuntime } from "./runtime";
import { QUOTE_TTL_MS, SimulatedVenue, TestnetDemoVenue, type VenueQuote } from "./venues";

type Order = typeof schema.orders.$inferSelect;
type Instrument = typeof schema.instruments.$inferSelect;
type PreviewInput = z.infer<typeof orderPreviewRequest>;
type Book = "simulated" | "testnet";

const buf = (hex: string) => Buffer.from(hex.slice(2), "hex");
const hex = (b: Buffer | null | undefined) => (b ? (`0x${b.toString("hex")}` as Hex) : null);
const addr = (b: Buffer) => getAddress(`0x${b.toString("hex")}`);

const RISKS: Record<Book, string[]> = {
  testnet: [
    "This is a Suiem demo token on Robinhood Chain TESTNET. It has no value and is not a share, a security or a Stock Token.",
    "The price comes from a third-party quote and is valid for 60 seconds. You sign the transaction in your own wallet; Suiem never trades for you.",
    "Testnet transactions are public on the explorer and cannot be reversed.",
  ],
  simulated: [
    "Simulated (paper) trade: nothing is bought or sold and no money moves.",
    "Fills use a third-party quote plus a disclosed fee and slippage model, so real results would differ.",
  ],
};

/** Ticker for pricing: SIM:NVDA / DEMO:TSLA → NVDA / TSLA. */
const tickerOf = (symbol: string) => symbol.split(":")[1]!;

@Injectable()
export class OrdersService {
  readonly simulated: SimulatedVenue;
  readonly testnet: TestnetDemoVenue;

  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(INVEST) private readonly rt: InvestRuntime,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {
    this.simulated = new SimulatedVenue(rt, priceToUnits);
    this.testnet = new TestnetDemoVenue(rt, priceToUnits);
  }

  // ---- gates ---------------------------------------------------------------------------------
  private async jurisdiction(userId: string) {
    const p = (
      await this.db.db
        .select({ j: schema.userPreferences.jurisdiction })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
    )[0];
    return stockTokenEligibility(p?.j ?? null);
  }

  /** Stock Token routes (testnet demo + faucet holdings) are jurisdiction-gated server-side (J-01). */
  async assertStockTokenEligible(userId: string) {
    const e = await this.jurisdiction(userId);
    if (!e.eligible)
      throw new ApiError(
        "POLICY_DENIED",
        e.reason === "restricted_jurisdiction"
          ? "Stock Token features are not available in your declared country (Robinhood RHJ restricted jurisdictions)."
          : "Declare your country in Settings to use Stock Token features. We ask because some countries are restricted.",
      );
  }

  async wallets(userId: string): Promise<Address[]> {
    const rows = await this.db.db
      .select({ a: schema.walletAccounts.address })
      .from(schema.walletAccounts)
      .where(
        and(eq(schema.walletAccounts.userId, userId), isNull(schema.walletAccounts.unlinkedAt)),
      );
    return rows.map((r) => addr(r.a));
  }

  async instrumentFor(
    entityCanonicalId: string,
    book: Book,
  ): Promise<{ inst: Instrument; entityId: string } | null> {
    const row = (
      await this.db.db
        .select({ inst: schema.instruments, entityId: schema.entities.canonicalId })
        .from(schema.instruments)
        .innerJoin(schema.entities, eq(schema.entities.id, schema.instruments.entityId))
        .where(
          and(
            eq(schema.entities.canonicalId, entityCanonicalId),
            eq(schema.instruments.legalType, book === "testnet" ? "demo_token" : "simulated"),
          ),
        )
    )[0];
    return row ?? null;
  }

  /** Per-day notional (USD 6 dp) of the user's live orders in a book. */
  /**
   * Per-day notional (USD 6 dp) of the user's orders in a book. Unexpired PREVIEWS count too: a
   * preview already carries a signed quote that could be sent onchain (security review).
   */
  private async todayNotional(userId: string, book: Book): Promise<bigint> {
    const now = this.clock.now();
    const since = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
    const rows = await this.db.db
      .select({
        side: schema.orders.side,
        quoteAmount: schema.orders.quoteAmount,
        est: schema.orders.estQuantity,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.userId, userId),
          bookIs(schema.orders.book, book),
          gte(schema.orders.createdAt, since),
          or(
            inArray(schema.orders.status, ["pending", "submitted", "filled"]),
            and(eq(schema.orders.status, "previewed"), gt(schema.orders.quoteExpiresAt, now)),
          ),
        ),
      );
    return rows.reduce((s, r) => s + BigInt(r.side === "buy" ? r.quoteAmount : r.est), 0n);
  }

  private async positionQty(userId: string, instrumentId: string, book: Book): Promise<bigint> {
    const p = (
      await this.db.db
        .select({ q: schema.positions.quantity })
        .from(schema.positions)
        .where(
          and(
            eq(schema.positions.userId, userId),
            eq(schema.positions.instrumentId, instrumentId),
            bookIs(schema.positions.book, book),
          ),
        )
    )[0];
    return BigInt(p?.q ?? "0");
  }

  // ---- preview -------------------------------------------------------------------------------
  async preview(
    userId: string,
    input: PreviewInput,
  ): Promise<z.infer<typeof orderPreviewResponse>> {
    const now = this.clock.now();
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const fail = (
      code:
        | "POLICY_DENIED"
        | "VALIDATION_FAILED"
        | "NOT_FOUND"
        | "FLAG_LOCKED"
        | "PROVIDER_UNAVAILABLE",
      message: string,
    ): never => {
      throw new ApiError(code, message);
    };
    if (await this.flags.isEnabled("trading.live")) fail("FLAG_LOCKED", "Live trading is disabled"); // can never be true (DB CHECK)

    if (input.book === "testnet") {
      if (!(await this.flags.isEnabled("trading.testnet")))
        fail("POLICY_DENIED", "Testnet trading is switched off right now.");
      checks.push({
        name: "Feature flag",
        ok: true,
        detail: "trading.testnet is on (trading.live is permanently off)",
      });
      await this.assertStockTokenEligible(userId);
      checks.push({
        name: "Jurisdiction",
        ok: true,
        detail: "Declared country is eligible (RHJ restricted list checked)",
      });
    }
    const found = await this.instrumentFor(input.entityId, input.book);
    if (!found)
      fail(
        "NOT_FOUND",
        input.book === "testnet"
          ? "There is no testnet demo token for this company."
          : "This company has no simulated instrument.",
      );
    const { inst } = found!;
    if (inst.status !== "active")
      fail(
        "POLICY_DENIED",
        input.book === "testnet"
          ? "The demo token for this company is not deployed or not verified yet, so it can't be traded."
          : "This instrument is not active.",
      );
    checks.push({
      name: "Instrument",
      ok: true,
      detail: `${inst.symbol} resolved from the registry and active`,
    });
    const ticker = tickerOf(inst.symbol);

    const side = input.side;
    const inDecimals = side === "buy" ? USD_DECIMALS : QTY_DECIMALS;
    let amountIn: bigint;
    try {
      amountIn = toUnits(input.amount, inDecimals);
    } catch {
      return fail(
        "VALIDATION_FAILED",
        side === "buy"
          ? "Amount has more than 6 decimal places"
          : "Quantity has more than 18 decimal places",
      );
    }
    if (amountIn <= 0n) fail("VALIDATION_FAILED", "Amount must be greater than zero");

    let quote: VenueQuote;
    try {
      quote = await (input.book === "testnet" ? this.testnet : this.simulated).quote(ticker, now);
    } catch {
      return fail(
        "PROVIDER_UNAVAILABLE",
        "No price is available right now, so no order can be previewed. Try again shortly.",
      );
    }

    // Limits are checked on USD notional.
    const notional = side === "buy" ? amountIn : (amountIn * quote.price) / 10n ** 18n;
    const perOrder = this.rt.limits.perOrderUsd * 10n ** 6n;
    if (notional > perOrder)
      fail("VALIDATION_FAILED", `Orders are limited to USD ${fromUnits(perOrder, 6)} each.`);
    const today = await this.todayNotional(userId, input.book);
    const perDay = this.rt.limits.perDayUsd * 10n ** 6n;
    if (today + notional > perDay)
      fail(
        "VALIDATION_FAILED",
        `Daily limit of USD ${fromUnits(perDay, 6)} reached for this book.`,
      );
    checks.push({
      name: "Limits",
      ok: true,
      detail: `Within USD ${fromUnits(perOrder, 6)} per order and USD ${fromUnits(perDay, 6)} per day`,
    });

    let trader: Address | null = null;
    let approval: z.infer<typeof orderPreviewResponse>["approval"] = null;
    let simulation = { ran: false, ok: true, detail: "Simulated book: no transaction" };
    const tokenAddress = inst.contractAddress ? addr(inst.contractAddress) : null;

    if (input.book === "testnet") {
      if (!this.rt.deployment || !this.rt.testnet || !this.rt.quoteSignerKey)
        fail("PROVIDER_UNAVAILABLE", "The testnet venue is not available right now.");
      const wallets = await this.wallets(userId);
      if (wallets.length === 0)
        fail("POLICY_DENIED", "Link a wallet in Settings to trade demo tokens on testnet.");
      trader = wallets[0]!;
      if (await this.testnet.paused()) fail("POLICY_DENIED", "The demo venue is paused.");
      checks.push({ name: "Venue", ok: true, detail: "SuiemDemoVenue is not paused" });
      const balance =
        side === "buy"
          ? await this.testnet.dusdBalance(trader)
          : await this.testnet.balanceOf(tokenAddress!, trader);
      if (balance < amountIn)
        fail(
          "VALIDATION_FAILED",
          side === "buy"
            ? `Not enough dUSD in ${trader} (have ${fromUnits(balance, 6)}). Use "Get demo dUSD".`
            : `Not enough d${ticker} in ${trader} (have ${fromUnits(balance, 18)}).`,
        );
      checks.push({
        name: "Balance",
        ok: true,
        detail:
          side === "buy"
            ? `${fromUnits(balance, 6)} dUSD available onchain`
            : `${fromUnits(balance, 18)} d${ticker} available onchain`,
      });
      if (side === "buy") {
        const allowance = await this.testnet.dusdAllowance(trader);
        const a = this.testnet.approval(amountIn);
        approval = {
          needed: allowance < amountIn,
          token: a.token,
          spender: a.spender,
          amount: fromUnits(amountIn, 6),
          data: a.data,
        };
      }
    } else if (side === "sell") {
      const held = await this.positionQty(userId, inst.id, "simulated");
      if (held < amountIn)
        fail("VALIDATION_FAILED", `You hold ${fromUnits(held, 18)} in the simulated book.`);
      checks.push({
        name: "Position",
        ok: true,
        detail: `${fromUnits(held, 18)} held (simulated)`,
      });
    }

    const venue = input.book === "testnet" ? this.testnet : this.simulated;
    const p = await venue.preview({ side, amountIn, quote, trader, token: tokenAddress });
    if (p.out <= 0n) fail("VALIDATION_FAILED", "The amount is too small to produce any output.");

    if (p.tx && trader) {
      if (approval?.needed)
        simulation = {
          ran: false,
          ok: true,
          detail: "Runs in your wallet after the exact-amount approval",
        };
      else {
        const reason = await this.testnet.simulate(trader, p.tx.data);
        simulation = { ran: true, ok: reason === null, detail: reason ?? "eth_call succeeded" };
        if (reason) fail("VALIDATION_FAILED", `The transaction would fail: ${reason}`);
      }
    }

    const outAsset =
      side === "buy"
        ? input.book === "testnet"
          ? `d${ticker}`
          : ticker
        : input.book === "testnet"
          ? "dUSD"
          : "USD";
    const inAsset =
      side === "buy"
        ? input.book === "testnet"
          ? "dUSD"
          : "USD"
        : input.book === "testnet"
          ? `d${ticker}`
          : ticker;
    const orderId = newId();
    await this.db.db.insert(schema.orders).values({
      id: orderId,
      userId,
      instrumentId: inst.id,
      book: input.book,
      side,
      status: "previewed",
      quoteAmount: amountIn.toString(),
      quoteDecimals: inDecimals,
      quoteAsset: inAsset,
      estQuantity: p.out.toString(),
      quantityDecimals: side === "buy" ? QTY_DECIMALS : USD_DECIMALS,
      feeAmount: p.fee.toString(),
      maxSlippageBps:
        input.book === "testnet" ? this.rt.limits.slippageBps : this.rt.limits.simSlippageBps,
      quoteAt: quote.quote.at,
      quoteExpiresAt: quote.expiresAt,
      chainId: input.book === "testnet" ? 46630 : null,
      previewHash: buf(p.previewHash),
      trader: trader ? buf(trader) : null,
      venue: input.book === "testnet" ? buf(this.rt.deployment!.venue) : null,
      quoteNonce: p.nonce?.toString() ?? null,
      quotePrice: p.executionPrice.toString(),
      priceDecimals: USD_DECIMALS,
      minOut: p.minOut.toString(),
      feeBps: p.feeBps,
      calldata: p.tx ? buf(p.tx.data) : null,
      quoteSource: {
        price: quote.quote.price,
        at: quote.quote.at.toISOString(),
        source: quote.quote.source,
        sourceUrl: quote.quote.sourceUrl,
      },
    });
    await this.event(orderId, "previewed", { previewHash: p.previewHash });

    const outDecimals = side === "buy" ? QTY_DECIMALS : USD_DECIMALS;
    return {
      orderId,
      book: input.book,
      bookLabel: BOOK_LABELS[input.book],
      side,
      instrument: {
        symbol: inst.symbol,
        displayName: inst.displayName,
        legalTypeLabel:
          input.book === "testnet"
            ? "Suiem demo token · testnet · no value · not a security"
            : "Simulated · paper trade · nothing is bought",
        network: input.book === "testnet" ? "testnet" : "offchain",
        chainId: input.book === "testnet" ? 46630 : null,
        address: tokenAddress,
      },
      amountIn: { value: fromUnits(amountIn, inDecimals), asset: inAsset },
      estimatedOut: { value: fromUnits(p.out, outDecimals), asset: outAsset },
      minOut: { value: fromUnits(p.minOut, outDecimals), asset: outAsset },
      fee: {
        value: fromUnits(p.fee, USD_DECIMALS),
        asset: input.book === "testnet" ? "dUSD" : "USD",
        bps: p.feeBps,
      },
      slippageBps:
        input.book === "testnet" ? this.rt.limits.slippageBps : this.rt.limits.simSlippageBps,
      price: {
        value: quote.quote.price,
        executionPrice: fromUnits(p.executionPrice, 6),
        currency: "USD",
        at: quote.quote.at.toISOString(),
        source: quote.quote.source,
        sourceUrl: quote.quote.sourceUrl,
      },
      expiresAt: quote.expiresAt.toISOString(),
      route:
        input.book === "testnet"
          ? {
              venue: this.rt.deployment!.venue,
              explorerUrl: explorerAddress(this.rt.deployment!.venue),
              description: "SuiemDemoVenue on Robinhood Chain testnet (46630)",
            }
          : {
              venue: null,
              explorerUrl: null,
              description: "Suiem simulated book (offchain paper trade)",
            },
      trader,
      approval,
      tx: p.tx,
      previewHash: p.previewHash,
      simulation,
      checks,
      risks: RISKS[input.book],
    };
  }

  // ---- confirm (Idempotency-Key) -------------------------------------------------------------
  async confirm(
    userId: string,
    body: { orderId: string; previewHash: string },
    idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      throw new ApiError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header (16–128 characters)",
      );
    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest();
    const existing = (
      await this.db.db
        .select()
        .from(schema.idempotencyKeys)
        .where(
          and(
            eq(schema.idempotencyKeys.scope, userId),
            eq(schema.idempotencyKeys.route, "POST /orders"),
            eq(schema.idempotencyKeys.key, idempotencyKey),
          ),
        )
    )[0];
    if (existing) {
      if (!existing.requestHash.equals(requestHash))
        throw new ApiError(
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was used for a different request",
        );
      return this.view(await this.own(userId, body.orderId));
    }
    const order = await this.own(userId, body.orderId);
    if (order.status !== "previewed")
      throw new ApiError("CONFLICT", `Order is already ${order.status}`);
    if (hex(order.previewHash) !== body.previewHash)
      throw new ApiError(
        "CONFLICT",
        "The preview changed. Review the new preview before confirming.",
      );
    const now = this.clock.now();
    if (now > order.quoteExpiresAt) {
      await this.setStatus(order.id, "expired", { reason: "quote expired before confirmation" });
      throw new ApiError("CONFLICT", "The quote expired. Get a new quote.");
    }
    await this.db.db.insert(schema.idempotencyKeys).values({
      scope: userId,
      route: "POST /orders",
      key: idempotencyKey,
      requestHash,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await this.db.db
      .update(schema.orders)
      .set({ status: "pending", confirmedAt: now })
      .where(eq(schema.orders.id, order.id));
    await this.event(order.id, "pending", { acknowledged: true });
    if (order.book === "simulated") await this.fillSimulated(order.id);
    return this.view(await this.own(userId, order.id));
  }

  private async fillSimulated(orderId: string) {
    const o = (
      await this.db.db.select().from(schema.orders).where(eq(schema.orders.id, orderId))
    )[0]!;
    await this.recordFill(o, {
      quantityOut: BigInt(o.estQuantity),
      price: BigInt(o.quotePrice!),
      fee: BigInt(o.feeAmount),
      filledAt: this.clock.now(),
      txHash: null,
      logIndex: null,
    });
  }

  // ---- submit + reconcile (testnet) ----------------------------------------------------------
  async submitTx(userId: string, orderId: string, txHash: Hex) {
    const order = await this.own(userId, orderId);
    if (order.book !== "testnet")
      throw new ApiError("VALIDATION_FAILED", "Only testnet orders have transactions");
    const known = hex(order.txHash);
    if (known) {
      if (known.toLowerCase() !== txHash.toLowerCase())
        throw new ApiError(
          "CONFLICT",
          "A different transaction is already recorded for this order",
        );
      return this.view(await this.reconcile(order)); // duplicate report: no-op apart from reconciling
    }
    if (order.status !== "pending")
      throw new ApiError(
        "CONFLICT",
        order.status === "previewed"
          ? "Confirm the order before submitting a transaction"
          : `Order is ${order.status}`,
      );
    // Store nothing until the transaction is visible and matches this order's preview: otherwise
    // another user could claim a pending hash first (tx-hash squatting, security review).
    const seen = await this.testnet.inspect(txHash);
    if (seen.state === "unknown")
      throw new ApiError(
        "CONFLICT",
        "The transaction is not visible on testnet yet. Retry in a few seconds.",
      );
    this.assertBinding(order, seen.from, seen.binding);
    const updated = await this.db.db
      .update(schema.orders)
      .set({ status: "submitted", txHash: buf(txHash) })
      .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "pending")))
      .returning({ id: schema.orders.id })
      .catch(() => {
        throw new ApiError("CONFLICT", "This transaction is already recorded for another order");
      });
    if (updated.length === 0) throw new ApiError("CONFLICT", "Order is no longer pending");
    await this.event(order.id, "submitted", { txHash });
    return this.view(await this.reconcile(await this.own(userId, order.id)));
  }

  /** The transaction must be exactly the previewed call, sent by the order's trader. */
  private assertBinding(order: Order, from: Address | undefined, binding: Hex | null | undefined) {
    if (!binding || binding !== hex(order.previewHash) || !from || from !== addr(order.trader!))
      throw new ApiError(
        "CONFLICT",
        "The transaction does not match the previewed order (target, amount, recipient or sender differ)",
      );
  }

  /** Server-side reconciliation from the chain. Positions only ever change here (or a simulated fill). */
  async reconcile(order: Order): Promise<Order> {
    const now = this.clock.now();
    if (order.status === "previewed" || order.status === "pending") {
      if (now > new Date(order.quoteExpiresAt.getTime() + 5_000))
        await this.setStatus(order.id, "expired", {
          reason: "quote expired without a transaction",
        });
      return this.reload(order.id);
    }
    if (order.status !== "submitted" || !order.txHash) return order;
    const seen = await this.testnet.inspect(hex(order.txHash)!);
    if (seen.state === "unknown" || seen.state === "pending") return order;
    try {
      this.assertBinding(order, seen.from, seen.binding);
    } catch {
      await this.setStatus(
        order.id,
        "failed",
        { reason: "transaction does not match the preview" },
        "Transaction did not match the preview",
      );
      return this.reload(order.id);
    }
    if (seen.state === "reverted") {
      const reason =
        now.getTime() / 1000 > Number(order.quoteExpiresAt.getTime() / 1000)
          ? "Transaction reverted (the quote may have expired)"
          : "Transaction reverted onchain";
      await this.setStatus(order.id, "failed", { block: seen.blockNumber.toString() }, reason);
      return this.reload(order.id);
    }
    const trade = seen.trades.find((t) => t.args.nonce.toString() === order.quoteNonce);
    if (
      !trade ||
      getAddress(trade.args.trader) !== addr(order.trader!) ||
      trade.args.amountIn.toString() !== order.quoteAmount ||
      trade.args.side !== (order.side === "buy" ? 0 : 1)
    ) {
      await this.setStatus(
        order.id,
        "failed",
        { reason: "no matching Trade event from the venue" },
        "No matching Trade event from the venue",
      );
      return this.reload(order.id);
    }
    await this.recordFill(order, {
      quantityOut: trade.args.amountOut,
      price: trade.args.price,
      fee: trade.args.fee,
      filledAt: seen.timestamp,
      txHash: hex(order.txHash)!,
      logIndex: trade.logIndex,
    });
    return this.reload(order.id);
  }

  /**
   * Writes the fill, ledger entries and position in one transaction. Duplicates (same order, or
   * same chain/tx/log) hit unique constraints and become no-ops.
   */
  private async recordFill(
    o: Order,
    f: {
      quantityOut: bigint;
      price: bigint;
      fee: bigint;
      filledAt: Date;
      txHash: Hex | null;
      logIndex: number | null;
    },
  ) {
    const book = o.book as Book;
    const amountIn = BigInt(o.quoteAmount);
    const [token, cash] = o.side === "buy" ? [f.quantityOut, amountIn] : [amountIn, f.quantityOut];
    const inst = (
      await this.db.db
        .select()
        .from(schema.instruments)
        .where(eq(schema.instruments.id, o.instrumentId))
    )[0]!;
    const assetToken = book === "testnet" ? `d${tickerOf(inst.symbol)}` : tickerOf(inst.symbol);
    const cashAsset = book === "testnet" ? "dUSD" : "USD";
    await this.db.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.fills)
        .values({
          id: newId(),
          orderId: o.id,
          quantity: token.toString(),
          quantityDecimals: QTY_DECIMALS,
          price: f.price.toString(),
          priceDecimals: USD_DECIMALS,
          feeAmount: f.fee.toString(),
          chainId: f.txHash ? 46630 : null,
          txHash: f.txHash ? buf(f.txHash) : null,
          logIndex: f.logIndex,
          filledAt: f.filledAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.fills.id });
      if (inserted.length === 0) return; // duplicate callback / event
      const entries =
        o.side === "buy"
          ? [
              {
                asset: cashAsset,
                amount: -(amountIn - f.fee),
                decimals: USD_DECIMALS,
                entryType: "buy" as const,
              },
              {
                asset: cashAsset,
                amount: -f.fee,
                decimals: USD_DECIMALS,
                entryType: "fee" as const,
              },
              {
                asset: assetToken,
                amount: token,
                decimals: QTY_DECIMALS,
                entryType: "buy" as const,
              },
            ]
          : [
              {
                asset: assetToken,
                amount: -token,
                decimals: QTY_DECIMALS,
                entryType: "sell" as const,
              },
              {
                asset: cashAsset,
                amount: cash + f.fee,
                decimals: USD_DECIMALS,
                entryType: "sell" as const,
              },
              {
                asset: cashAsset,
                amount: -f.fee,
                decimals: USD_DECIMALS,
                entryType: "fee" as const,
              },
            ];
      await tx.insert(schema.ledgerEntries).values(
        entries.map((e) => ({
          id: newId(),
          userId: o.userId,
          book,
          instrumentId: o.instrumentId,
          asset: e.asset,
          amount: e.amount.toString(),
          decimals: e.decimals,
          entryType: e.entryType,
          orderId: o.id,
        })),
      );
      // Position from reconciled fills only (average cost).
      const pos = (
        await tx
          .select()
          .from(schema.positions)
          .where(
            and(
              eq(schema.positions.userId, o.userId),
              eq(schema.positions.instrumentId, o.instrumentId),
              bookIs(schema.positions.book, book),
            ),
          )
          .for("update")
      )[0];
      const state = {
        quantity: BigInt(pos?.quantity ?? "0"),
        costBasis: BigInt(pos?.costBasis ?? "0"),
        realized: 0n,
      };
      const fill: Fill = { side: o.side, quantity: token, cash };
      const next = applyFill(state, fill);
      if (pos)
        await tx
          .update(schema.positions)
          .set({
            quantity: next.quantity.toString(),
            costBasis: next.costBasis.toString(),
            updatedAt: f.filledAt,
          })
          .where(eq(schema.positions.id, pos.id));
      else
        await tx.insert(schema.positions).values({
          id: newId(),
          userId: o.userId,
          instrumentId: o.instrumentId,
          book,
          quantity: next.quantity.toString(),
          quantityDecimals: QTY_DECIMALS,
          costBasis: next.costBasis.toString(),
          costDecimals: USD_DECIMALS,
          updatedAt: f.filledAt,
        });
      await tx
        .update(schema.orders)
        .set({
          status: "filled",
          filledQuantity: token.toString(),
          filledAmount: cash.toString(),
          feeAmount: f.fee.toString(),
          failureReason: null,
        })
        .where(eq(schema.orders.id, o.id));
      await tx.insert(schema.orderEvents).values({
        id: newId(),
        orderId: o.id,
        status: "filled",
        details: {
          txHash: f.txHash,
          logIndex: f.logIndex,
          out: f.quantityOut.toString(),
          fee: f.fee.toString(),
        },
      });
    });
  }

  // ---- reads ---------------------------------------------------------------------------------
  async own(userId: string, id: string): Promise<Order> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError("NOT_FOUND", "Unknown order");
    const o = (
      await this.db.db
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.id, id), eq(schema.orders.userId, userId)))
    )[0];
    if (!o) throw new ApiError("NOT_FOUND", "Unknown order");
    return o;
  }
  private async reload(id: string) {
    return (await this.db.db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!;
  }
  private async setStatus(
    id: string,
    status: Order["status"],
    details: Record<string, unknown>,
    failureReason?: string,
  ) {
    await this.db.db
      .update(schema.orders)
      .set({ status, failureReason: failureReason ?? null })
      .where(eq(schema.orders.id, id));
    await this.event(id, status, details);
  }
  private async event(orderId: string, status: string, details: Record<string, unknown>) {
    await this.db.db.insert(schema.orderEvents).values({ id: newId(), orderId, status, details });
  }

  async view(o: Order): Promise<z.infer<typeof orderResponse>> {
    const row = (
      await this.db.db
        .select({
          symbol: schema.instruments.symbol,
          displayName: schema.instruments.displayName,
          entityId: schema.entities.canonicalId,
        })
        .from(schema.instruments)
        .leftJoin(schema.entities, eq(schema.entities.id, schema.instruments.entityId))
        .where(eq(schema.instruments.id, o.instrumentId))
    )[0]!;
    const book = o.book as Book;
    const outAsset =
      o.side === "buy"
        ? book === "testnet"
          ? `d${tickerOf(row.symbol)}`
          : tickerOf(row.symbol)
        : book === "testnet"
          ? "dUSD"
          : "USD";
    const txHash = hex(o.txHash);
    return {
      id: o.id,
      book,
      bookLabel: BOOK_LABELS[book],
      side: o.side,
      status: o.status,
      symbol: row.symbol,
      displayName: row.displayName,
      entityId: row.entityId,
      amountIn: {
        value: fromUnits(BigInt(o.quoteAmount), o.quoteDecimals as 6 | 18),
        asset: o.quoteAsset,
      },
      estimatedOut: {
        value: fromUnits(BigInt(o.estQuantity), o.quantityDecimals as 6 | 18),
        asset: outAsset,
      },
      filledOut:
        o.status === "filled" && o.filledQuantity
          ? {
              value:
                o.side === "buy"
                  ? fromUnits(BigInt(o.filledQuantity), 18)
                  : fromUnits(BigInt(o.filledAmount!), 6),
              asset: outAsset,
            }
          : null,
      fee: fromUnits(BigInt(o.feeAmount), 6),
      price: fromUnits(BigInt(o.quotePrice ?? "0"), 6),
      quoteAt: o.quoteAt.toISOString(),
      expiresAt: o.quoteExpiresAt.toISOString(),
      txHash,
      explorerUrl: txHash ? explorerTx(txHash) : null,
      failureReason: o.failureReason,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  /** What the UI needs to decide which trading buttons to show, and why not. */
  async status(userId: string) {
    const e = await this.jurisdiction(userId);
    const flag = await this.flags.isEnabled("trading.testnet");
    const d = this.rt.deployment;
    const reason = !e.eligible
      ? e.reason === "restricted_jurisdiction"
        ? "Stock Token features are not available in your declared country."
        : "Declare your country in Settings to use Stock Token features."
      : !flag
        ? "Testnet trading is switched off right now."
        : !d || !this.rt.testnet || !this.rt.quoteSignerKey
          ? "The testnet demo venue is not deployed yet."
          : null;
    return {
      eligibility: {
        eligible: e.eligible,
        reason: e.eligible ? null : e.reason,
        message: e.eligible ? null : reason,
      },
      testnet: {
        available: reason === null,
        reason,
        chainId: 46630 as const,
        venue: d?.venue ?? null,
        dusd: d?.dusd ?? null,
        tokens: d?.tokens ?? {},
        explorer: "https://explorer.testnet.chain.robinhood.com",
        faucetUrl: "https://faucet.testnet.chain.robinhood.com",
        wallets: await this.wallets(userId),
      },
      simulated: {
        available: true as const,
        feeBps: this.rt.limits.simFeeBps,
        slippageBps: this.rt.limits.simSlippageBps,
      },
      quoteTtlSeconds: QUOTE_TTL_MS / 1000,
    };
  }

  async list(userId: string, limit = 100) {
    const rows = await this.db.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.userId, userId), sql`${schema.orders.status} <> 'previewed'`))
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit);
    return Promise.all(rows.map((o) => this.view(o)));
  }
}
