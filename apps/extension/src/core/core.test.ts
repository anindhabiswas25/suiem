import { describe, expect, test } from "vitest";
import { addItem, group, makeItem, nextDelivery, purge } from "./digest";
import { prune, shouldNotify } from "./ratelimit";
import {
  allowsContext,
  INITIAL_STATE,
  isActive,
  nextMidnight,
  normalizeHost,
  reduce,
  type PrivacyState,
} from "./state";

const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);
const s = (patch: Partial<PrivacyState> = {}): PrivacyState => ({ ...INITIAL_STATE, ...patch });

describe("state machine transitions", () => {
  test("on → off → on", () => {
    const off = reduce(s(), { type: "turnOff" }, T0);
    expect(isActive(off, T0)).toBe(false);
    expect(isActive(reduce(off, { type: "turnOn" }, T0), T0)).toBe(true);
  });

  test("pause for 30 min / 1 h expires and tick restores on", () => {
    for (const minutes of [30, 60]) {
      const p = reduce(s(), { type: "pause", choice: { kind: "minutes", minutes } }, T0);
      expect(p.mode).toEqual({ kind: "paused", until: T0 + minutes * 60_000 });
      expect(isActive(p, T0 + minutes * 60_000 - 1)).toBe(false);
      expect(reduce(p, { type: "tick" }, T0 + minutes * 60_000 - 1).mode.kind).toBe("paused");
      const resumed = reduce(p, { type: "tick" }, T0 + minutes * 60_000);
      expect(resumed.mode).toEqual({ kind: "on" });
    }
  });

  test("custom pause is clamped to 1 minute .. 7 days", () => {
    expect(
      reduce(s(), { type: "pause", choice: { kind: "minutes", minutes: 0 } }, T0).mode,
    ).toEqual({ kind: "paused", until: T0 + 60_000 });
    expect(
      reduce(s(), { type: "pause", choice: { kind: "minutes", minutes: 1e9 } }, T0).mode,
    ).toEqual({ kind: "paused", until: T0 + 7 * 86_400_000 });
  });

  test("until tomorrow = next local midnight", () => {
    expect(nextMidnight(T0, 0)).toBe(Date.UTC(2026, 10, 12));
    // UTC+5:30 (offset -330): local time is 15:30, so local midnight is 18:30 UTC.
    expect(nextMidnight(T0, -330)).toBe(Date.UTC(2026, 10, 11, 18, 30));
    const p = reduce(s(), { type: "pause", choice: { kind: "untilTomorrow" } }, T0, 0);
    expect(p.mode).toEqual({ kind: "paused", until: Date.UTC(2026, 10, 12) });
  });

  test("tick does nothing when on or off", () => {
    expect(reduce(s(), { type: "tick" }, T0)).toEqual(s());
    const off = reduce(s(), { type: "turnOff" }, T0);
    expect(reduce(off, { type: "tick" }, T0 + 1e9)).toEqual(off);
  });

  test("private tab excludes only that tab and clears on close", () => {
    const p = reduce(s(), { type: "privateTab", tabId: 7, on: true }, T0);
    expect(allowsContext(p, T0, { tabId: 7 })).toBe(false);
    expect(allowsContext(p, T0, { tabId: 8 })).toBe(true);
    expect(reduce(p, { type: "tabClosed", tabId: 7 }, T0).privateTabs).toEqual([]);
    expect(reduce(p, { type: "privateTab", tabId: 7, on: false }, T0).privateTabs).toEqual([]);
  });

  test("private site excludes the site and its subdomains", () => {
    const p = reduce(s(), { type: "privateSite", host: "https://www.X.com/home", on: true }, T0);
    expect(p.privateSites).toEqual(["x.com"]);
    expect(allowsContext(p, T0, { host: "x.com" })).toBe(false);
    expect(allowsContext(p, T0, { host: "mobile.x.com" })).toBe(false);
    expect(allowsContext(p, T0, { host: "notx.com" })).toBe(true);
    expect(reduce(p, { type: "privateSite", host: "x.com", on: false }, T0).privateSites).toEqual(
      [],
    );
    expect(
      reduce(s(), { type: "privateSite", host: "not a host", on: true }, T0).privateSites,
    ).toEqual([]);
  });

  test("private session makes everything inactive, even when on", () => {
    const p = reduce(s(), { type: "privateSession", on: true }, T0);
    expect(isActive(p, T0)).toBe(false);
    expect(isActive(reduce(p, { type: "privateSession", on: false }, T0), T0)).toBe(true);
  });

  test("off/paused deny every context", () => {
    for (const st of [
      reduce(s(), { type: "turnOff" }, T0),
      reduce(s(), { type: "pause", choice: { kind: "minutes", minutes: 30 } }, T0),
    ]) {
      expect(allowsContext(st, T0, { tabId: 1, host: "x.com" })).toBe(false);
    }
  });

  test("normalizeHost", () => {
    expect(normalizeHost("https://twitter.com/foo?x=1")).toBe("twitter.com");
    expect(normalizeHost("localhost:3000")).toBe("localhost");
    expect(normalizeHost("127.0.0.1:4100")).toBe("127.0.0.1");
    expect(normalizeHost("javascript:alert(1)")).toBeNull();
  });
});

describe("notification rate limits", () => {
  test("once per entity per 30 minutes", () => {
    const h = [{ entityId: "ent:nvidia", domain: "x.com", at: T0 }];
    expect(shouldNotify(h, { entityId: "ent:nvidia", domain: "x.com" }, T0 + 29 * 60_000)).toBe(
      false,
    );
    expect(shouldNotify(h, { entityId: "ent:nvidia", domain: "x.com" }, T0 + 30 * 60_000)).toBe(
      true,
    );
    expect(shouldNotify(h, { entityId: "ent:tesla", domain: "x.com" }, T0 + 1)).toBe(true);
  });
  test("at most 3 per domain per hour", () => {
    const h = ["a", "b", "c"].map((e, i) => ({
      entityId: `ent:${e}`,
      domain: "x.com",
      at: T0 + i,
    }));
    expect(shouldNotify(h, { entityId: "ent:d", domain: "x.com" }, T0 + 10)).toBe(false);
    expect(shouldNotify(h, { entityId: "ent:d", domain: "other.com" }, T0 + 10)).toBe(true);
    expect(shouldNotify(h, { entityId: "ent:d", domain: "x.com" }, T0 + 3_600_001)).toBe(true);
    expect(prune(h, T0 + 3_600_010)).toEqual([]);
  });
});

describe("local digest", () => {
  const nv = { id: "ent:nvidia", name: "NVIDIA" };
  test("only intentional action kinds exist, each with a reason", () => {
    const items = addItem([], makeItem("watchlist_added", nv, "x.com", T0, "1"));
    expect(items[0]!.why).toMatch(/added it to your watchlist/);
    expect(group(items).map((g) => g.title)).toEqual(["Watchlist changes"]);
  });
  test("duplicates within an hour collapse; retention purge drops old items", () => {
    let items = addItem([], makeItem("panel_opened", nv, "x.com", T0, "1"));
    items = addItem(items, makeItem("panel_opened", nv, "x.com", T0 + 60_000, "2"));
    expect(items).toHaveLength(1);
    items = addItem(items, makeItem("panel_opened", nv, "x.com", T0 - 31 * 86_400_000, "3"));
    expect(purge(items, T0, 30)).toHaveLength(1);
  });
  test("next delivery time respects the timezone", () => {
    expect(nextDelivery(T0, "18:00", "UTC")).toBe(Date.UTC(2026, 10, 11, 18));
    expect(nextDelivery(T0, "09:00", "UTC")).toBe(Date.UTC(2026, 10, 12, 9));
    expect(nextDelivery(T0, "18:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 11, 12, 30));
    expect(nextDelivery(T0, "15:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 12, 9, 30));
  });
});
