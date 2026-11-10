import { describe, expect, test } from "vitest";
import { isUuidV7, newId } from "./ids";
describe("ids", () => {
  test("newId produces time-ordered UUIDv7 values", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });
  test("rejects other UUID versions and junk", () => {
    expect(isUuidV7("6f1c2d6e-1a2b-4c3d-8e9f-001122334455")).toBe(false);
    expect(isUuidV7("not-a-uuid")).toBe(false);
  });
});
