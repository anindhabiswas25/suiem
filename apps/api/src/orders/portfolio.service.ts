import { Inject, Injectable } from "@nestjs/common";
import { demoStockTokenAbi } from "@suiem/chain/abi";
import { type DbHandle, schema } from "@suiem/db";
import { BOOK_LABELS } from "@suiem/shared/invest";
import type {
  faucetHoldingsResponse,
  portfolioBook,
  portfolioResponse,
} from "@suiem/shared/schemas";
import { and, asc, eq } from "drizzle-orm";
import { getAddress } from "viem";
import type { z } from "zod";
import { averageCost, type Fill, fromUnits, priceToUnits, replay, valueOf } from "./math";
import { OrdersService } from "./orders.service";
import { bookIs } from "./sql";
import { INVEST, type InvestRuntime, type PriceQuote } from "./runtime";
import { DB } from "../tokens";

type Book = "simulated" | "testnet";
const tickerOf = (symbol: string) => symbol.split(":")[1]!;
const signed = (v: bigint, d: 6 | 18) => (v < 0n ? `-${fromUnits(-v, d)}` : fromUnits(v, d));

export const METHODOLOGY =
  "Average cost: each buy adds its quantity and full cash cost (fees included); a sell removes cost in proportion to the quantity sold, and realized P&L is the cash received minus the cost removed. Unrealized P&L is market value at the latest quote minus remaining cost. All arithmetic uses integers (no floating point). Books are never added together.";

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(INVEST) private readonly rt: InvestRuntime,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  /** Filled orders for a book, oldest first, grouped by instrument. */
  private async fills(userId: string, book: Book) {
    const rows = await this.db.db
      .select({
        o: schema.orders,
        f: schema.fills,
        inst: schema.instruments,
        entityId: schema.entities.canonicalId,
      })
      .from(schema.fills)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.fills.orderId))
      .innerJoin(schema.instruments, eq(schema.instruments.id, schema.orders.instrumentId))
      .leftJoin(schema.entities, eq(schema.entities.id, schema.instruments.entityId))
      .where(and(eq(schema.orders.userId, userId), bookIs(schema.orders.book, book)))
      .orderBy(asc(schema.fills.filledAt));
    return rows.map((r) => ({
      instrumentId: r.inst.id,
      symbol: r.inst.symbol,
      displayName: r.inst.displayName,
      entityId: r.entityId,
      at: r.f.filledAt,
      price: BigInt(r.f.price),
      fill: {
        side: r.o.side,
        quantity: BigInt(r.f.quantity),
        cash: BigInt(r.o.filledAmount ?? r.o.quoteAmount),
      } satisfies Fill,
    }));
  }

  private async priceOrNull(ticker: string, cache: Map<string, PriceQuote | null>) {
    if (!cache.has(ticker)) cache.set(ticker, await this.rt.price(ticker).catch(() => null));
    return cache.get(ticker)!;
  }

  private async book(
    userId: string,
    book: Book,
    prices: Map<string, PriceQuote | null>,
  ): Promise<z.infer<typeof portfolioBook>> {
    const all = await this.fills(userId, book);
    const currency = book === "testnet" ? "dUSD" : "USD";
    const byInst = new Map<string, typeof all>();
    for (const r of all) byInst.set(r.instrumentId, [...(byInst.get(r.instrumentId) ?? []), r]);
    const positions: z.infer<typeof portfolioBook>["positions"] = [];
    let cost = 0n;
    let value: bigint | null = 0n;
    let unreal: bigint | null = 0n;
    let realized = 0n;
    for (const rows of byInst.values()) {
      const head = rows[0]!;
      const state = replay(rows.map((r) => r.fill));
      const q = await this.priceOrNull(tickerOf(head.symbol), prices);
      const price = q ? priceToUnits(q.price) : null;
      const mv = price !== null ? valueOf(state.quantity, price) : null;
      const avg = averageCost(state);
      cost += state.costBasis;
      realized += state.realized;
      value = value !== null && mv !== null ? value + mv : null;
      unreal = unreal !== null && mv !== null ? unreal + (mv - state.costBasis) : null;
      positions.push({
        instrumentSymbol: head.symbol,
        displayName: head.displayName,
        entityId: head.entityId,
        quantity: fromUnits(state.quantity, 18),
        averageCost: avg === null ? null : { value: fromUnits(avg, 6), currency },
        costBasis: { value: fromUnits(state.costBasis, 6), currency },
        price: q ? { value: q.price, at: q.at.toISOString(), source: q.source } : null,
        marketValue: mv === null ? null : { value: fromUnits(mv, 6), currency },
        unrealizedPnl: mv === null ? null : { value: signed(mv - state.costBasis, 6), currency },
        realizedPnl: { value: signed(state.realized, 6), currency },
      });
    }
    return {
      book,
      label: BOOK_LABELS[book],
      currency,
      positions,
      totals: positions.length
        ? {
            costBasis: { value: fromUnits(cost, 6), currency },
            marketValue: value === null ? null : { value: fromUnits(value, 6), currency },
            unrealizedPnl: unreal === null ? null : { value: signed(unreal, 6), currency },
            realizedPnl: { value: signed(realized, 6), currency },
          }
        : null,
      note:
        book === "testnet"
          ? "Demo tokens and dUSD on testnet have no value. Values use the real quote only to make the demo meaningful."
          : "Paper trades. Nothing was bought.",
    };
  }

  async portfolio(userId: string): Promise<z.infer<typeof portfolioResponse>> {
    const prices = new Map<string, PriceQuote | null>();
    const faucet = await this.faucetHoldings(userId);
    return {
      books: {
        simulated: await this.book(userId, "simulated", prices),
        testnet: await this.book(userId, "testnet", prices),
        faucet: {
          book: "faucet",
          label: BOOK_LABELS.faucet,
          currency: "none",
          positions: faucet.items.map((i) => ({
            instrumentSymbol: `TEST:${i.symbol}`,
            displayName: `${i.name} (testnet test token)`,
            entityId: null,
            quantity: i.balance,
            averageCost: null,
            costBasis: { value: "0", currency: "none" },
            price: null,
            marketValue: null,
            unrealizedPnl: null,
            realizedPnl: { value: "0", currency: "none" },
          })),
          totals: null,
          note:
            faucet.note ??
            "Read-only balances of Robinhood Chain testnet test tokens in your linked wallet. Suiem never trades or values them.",
        },
      },
      methodology: METHODOLOGY,
    };
  }

  /** Read-only balances of VERIFIED faucet tokens in the user's linked wallets (testnet RPC). */
  async faucetHoldings(userId: string): Promise<z.infer<typeof faucetHoldingsResponse>> {
    const label = BOOK_LABELS.faucet;
    try {
      await this.orders.assertStockTokenEligible(userId);
    } catch (e) {
      return { label, items: [], note: (e as Error).message };
    }
    const wallets = await this.orders.wallets(userId);
    if (!wallets.length)
      return {
        label,
        items: [],
        note: "Link a wallet in Settings to see your faucet test tokens.",
      };
    if (!this.rt.testnet) return { label, items: [], note: "Testnet RPC is not configured." };
    const insts = await this.db.db
      .select()
      .from(schema.instruments)
      .where(eq(schema.instruments.legalType, "testnet_test_token"));
    const items: z.infer<typeof faucetHoldingsResponse>["items"] = [];
    const hidden: string[] = [];
    for (const inst of insts) {
      if (inst.status !== "active" || !inst.contractAddress) {
        hidden.push(inst.symbol);
        continue;
      }
      const address = getAddress(`0x${inst.contractAddress.toString("hex")}`);
      for (const w of wallets) {
        const bal = await this.rt.testnet
          .readContract({ address, abi: demoStockTokenAbi, functionName: "balanceOf", args: [w] })
          .catch(() => null);
        if (bal === null) continue;
        items.push({
          wallet: w,
          symbol: tickerOf(inst.symbol),
          name: inst.displayName,
          address,
          balance: fromUnits(bal, 18),
          status: "active",
        });
      }
    }
    return {
      label,
      items,
      note: hidden.length ? `Balances hidden for unverified tokens: ${hidden.join(", ")}.` : null,
    };
  }

  /** Value snapshots per book at each fill (fill prices) plus now (latest quotes). Never summed across books. */
  async history(userId: string) {
    const out: Record<Book, { at: string; value: string }[]> = { simulated: [], testnet: [] };
    const prices = new Map<string, PriceQuote | null>();
    for (const book of ["simulated", "testnet"] as const) {
      const rows = await this.fills(userId, book);
      const held = new Map<string, { qty: bigint; price: bigint; symbol: string }>();
      for (const r of rows) {
        const h = held.get(r.instrumentId) ?? { qty: 0n, price: r.price, symbol: r.symbol };
        h.qty = r.fill.side === "buy" ? h.qty + r.fill.quantity : h.qty - r.fill.quantity;
        h.price = r.price;
        held.set(r.instrumentId, h);
        const total = [...held.values()].reduce((s, x) => s + valueOf(x.qty, x.price), 0n);
        out[book].push({ at: r.at.toISOString(), value: fromUnits(total, 6) });
      }
      if (rows.length) {
        let total = 0n;
        for (const x of held.values()) {
          const q = await this.priceOrNull(tickerOf(x.symbol), prices);
          total += valueOf(x.qty, q ? priceToUnits(q.price) : x.price);
        }
        out[book].push({ at: new Date().toISOString(), value: fromUnits(total, 6) });
      }
    }
    return {
      books: out,
      note: "Snapshots at each fill (fill price) and now (latest quote). Testnet values are in dUSD (no value). Books are separate.",
    };
  }

  async csv(userId: string): Promise<string> {
    const items = await this.orders.list(userId, 1000);
    const esc = (v: string | null) =>
      v === null ? "" : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const head =
      "created_at,book,side,status,symbol,amount_in,asset_in,estimated_out,filled_out,asset_out,fee,price_usd,quote_at,tx_hash,explorer_url";
    const lines = items.map((o) =>
      [
        o.createdAt,
        o.bookLabel,
        o.side,
        o.status,
        o.symbol,
        o.amountIn.value,
        o.amountIn.asset,
        o.estimatedOut.value,
        o.filledOut?.value ?? null,
        o.estimatedOut.asset,
        o.fee,
        o.price,
        o.quoteAt,
        o.txHash,
        o.explorerUrl,
      ]
        .map(esc)
        .join(","),
    );
    return `${[head, ...lines].join("\n")}\n`;
  }
}
