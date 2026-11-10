import { describe, expect, test } from "vitest";
import { detectionSchema } from "../extension/messages";
import { detect, NOTIFY_THRESHOLD, notifiable, spanHash } from "./detector";
import { ENTITY_DICTIONARY, entityById, TESTNET_STOCK_TOKEN_ENTITIES } from "./dictionary";

const now = new Date("2026-11-11T00:00:00Z");
const run = (text: string) => detect(text, { domain: "x.com", now });
const notifies = (text: string) => notifiable(run(text)).map((d) => d.entityId);

/** [text, entity ids that must notify]. An empty list means "must not notify anything". */
const CORPUS: [string, string[]][] = [
  // Clear mentions notify.
  ["$NVDA earnings beat expectations again", ["ent:nvidia"]],
  ["Nvidia CEO Jensen Huang says demand is insane", ["ent:nvidia"]],
  ["NVIDIA Corporation reported record data center revenue", ["ent:nvidia"]],
  ["Thinking about NVDA after the selloff", ["ent:nvidia"]],
  ["NASDAQ:NVDA is up 4% premarket", ["ent:nvidia"]],
  ["$TSLA deliveries come out tomorrow", ["ent:tesla"]],
  ["Tesla shares jumped after the robotaxi event", ["ent:tesla"]],
  ["Palantir just won another government contract", ["ent:palantir"]],
  ["$PLTR $AMD $NFLX all green today", ["ent:palantir", "ent:amd", "ent:netflix"]],
  ["Netflix subscriber growth surprised analysts", ["ent:netflix"]],
  ["Advanced Micro Devices unveiled a new accelerator", ["ent:amd"]],
  ["Microsoft and Alphabet both report on Tuesday", ["ent:microsoft"]],
  ["Apple stock fell 2% after the iPhone event", ["ent:apple"]],
  ["Apple Inc. raised its dividend", ["ent:apple"]],
  ["Amazon earnings: AWS growth accelerates", ["ent:amazon"]],
  ["Meta shares hit an all-time high", ["ent:meta"]],
  ["$META ad revenue is the story", ["ent:meta"]],
  ["Meta Platforms is spending billions on AI", ["ent:meta"]],
  ["Intel CEO outlines foundry plans", ["ent:intel"]],
  ["Oracle earnings blew past estimates", ["ent:oracle"]],
  ["ON Semiconductor guidance was weak", ["ent:onsemi"]],
  ["$ON shares slid after the quarterly report", ["ent:onsemi"]],
  ["Arm Holdings IPO was oversubscribed", ["ent:arm"]],
  ["$BTC just broke 100k", ["ent:bitcoin"]],
  ["$SPY options volume is huge today", ["ent:spy-etf"]],

  // Ordinary words, ticker collisions and products stay silent.
  ["Apple pie recipe with cinnamon and brown sugar", []],
  ["We picked apples at the orchard this weekend", []],
  ["A new meta-analysis of sleep studies", []],
  ["The meta is shifting in this patch, healers are back", []],
  ["$ON sale this weekend only", []],
  ["Everything is 50% ON sale", []],
  ["the market is up today", []],
  ["I love my Tesla", []],
  ["My new Tesla arrived and it drives great", []],
  ["We need ALL hands on deck", []],
  ["IT department is rebooting the servers", []],
  ["He hurt his arm playing football", []],
  ["My Visa card was declined", []],
  ["The Amazon rainforest is losing trees", []],
  ["Got intel on the surprise party", []],
  ["She is an oracle of good advice", []],
  ["Just a normal sentence about lunch", []],
  ["Meeting at 5 PM, V for victory", []],
  ["MA programs in history are competitive", []],
  ["Consult the oracle before the quest", []],
  ["", []],
];

describe("detector corpus", () => {
  test(`has at least 40 cases`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(40);
  });

  for (const [text, expected] of CORPUS) {
    test(`${expected.length ? "notifies" : "silent"}: ${JSON.stringify(text)}`, () => {
      expect(notifies(text).sort()).toEqual([...expected].sort());
    });
  }
});

describe("detector output", () => {
  test("matches detectionSchema and never contains the text", () => {
    const text = "$NVDA earnings beat expectations again";
    const [d] = run(text);
    expect(detectionSchema.parse(d)).toBeTruthy();
    expect(d!.evidenceSpanHash).toBe(spanHash("$NVDA"));
    expect(JSON.stringify(d)).not.toContain("earnings");
    expect(JSON.stringify(d)).not.toContain("$NVDA");
  });

  test("ambiguous words below threshold are 'possible match' or 'ambiguous' with a reason", () => {
    const d = run("$ON sale this weekend only").find((x) => x.entityId === "ent:onsemi");
    expect(d).toMatchObject({ contextCategory: "possible_match", confidence: 0.5 });
    expect(d!.ambiguityReason).toBeTruthy();
    const pie = run("Apple pie recipe").find((x) => x.entityId === "ent:apple");
    expect(pie).toBeUndefined();
  });

  test("crypto, index and fund entities are typed, not treated as companies", () => {
    expect(run("$BTC and $ETH are both up")[0]!.entityKind).toBe("crypto");
    expect(run("The S&P 500 closed at a record")[0]).toMatchObject({
      entityId: "ent:sp500",
      entityKind: "index",
    });
    expect(run("Invesco QQQ inflows were strong")[0]).toMatchObject({ entityKind: "fund" });
  });

  test("threshold is 0.8 and configurable", () => {
    expect(NOTIFY_THRESHOLD).toBe(0.8);
    const all = run("$ON sale this weekend only");
    expect(notifiable(all, 0.5).length).toBe(1);
  });

  test("one detection per entity, sorted by confidence", () => {
    const d = run("NVDA NVDA $NVDA Nvidia NVIDIA Corporation, also $TSLA");
    expect(d.map((x) => x.entityId).sort()).toEqual(["ent:nvidia", "ent:tesla"]);
    expect(d[0]!.confidence).toBeGreaterThanOrEqual(d[1]!.confidence);
  });
});

describe("dictionary", () => {
  test("has ~40 entities including the 5 testnet Stock Token names and the big five", () => {
    expect(ENTITY_DICTIONARY.length).toBe(40);
    for (const slug of [
      ...TESTNET_STOCK_TOKEN_ENTITIES,
      "nvidia",
      "apple",
      "microsoft",
      "alphabet",
      "meta",
    ]) {
      expect(entityById(`ent:${slug}`), slug).toBeDefined();
    }
  });
  test("ordinary-word aliases are flagged ambiguous", () => {
    const amb = (slug: string, alias: string) =>
      entityById(`ent:${slug}`)!.aliases.find((a) => a.alias === alias)!.ambiguous;
    expect(amb("apple", "Apple")).toBe(true);
    expect(amb("meta", "Meta")).toBe(true);
    expect(amb("amazon", "Amazon")).toBe(true);
    expect(amb("onsemi", "ON")).toBe(true);
    expect(amb("allstate", "ALL")).toBe(true);
    expect(amb("gartner", "IT")).toBe(true);
    expect(amb("nvidia", "NVDA")).toBe(false);
  });
  test("canonical ids are unique and well formed", () => {
    const ids = ENTITY_DICTIONARY.map((e) => e.canonicalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^ent:[a-z0-9-]+$/.test(id))).toBe(true);
  });
});
