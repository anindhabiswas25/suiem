/** Demo seed data. Entities come from @suiem/shared/entities (public reference facts, no market data). */
import { ENTITY_DICTIONARY } from "@suiem/shared/entities";

/** Single source of truth: the shared dictionary (also used by the extension's detector). */
export const SEED_ENTITIES = ENTITY_DICTIONARY;

/**
 * The 5 test Stock Tokens the official faucet hands out (VERIFIED_FACTS T-02). Their contract
 * addresses are UNVERIFIED (T-05), so they stay `unverified` with no address until Sprint 5.
 */
export const TESTNET_STOCK_TOKENS = [
  { entity: "tesla", ticker: "TSLA", symbol: "TEST:TSLA", name: "Tesla test token" },
  { entity: "amazon", ticker: "AMZN", symbol: "TEST:AMZN", name: "Amazon test token" },
  { entity: "palantir", ticker: "PLTR", symbol: "TEST:PLTR", name: "Palantir test token" },
  { entity: "netflix", ticker: "NFLX", symbol: "TEST:NFLX", name: "Netflix test token" },
  { entity: "amd", ticker: "AMD", symbol: "TEST:AMD", name: "AMD test token" },
] as const;

export const DEMO_USERS = [
  {
    handle: "demo_ada",
    displayName: "Ada (demo)",
    interests: ["technology", "ai"],
    jurisdiction: "IN",
  },
  {
    handle: "demo_grace",
    displayName: "Grace (demo)",
    interests: ["healthcare", "finance"],
    jurisdiction: "DE",
  },
  {
    handle: "demo_alan",
    displayName: "Alan (demo)",
    interests: ["energy", "consumer"],
    jurisdiction: "SG",
  },
] as const;
