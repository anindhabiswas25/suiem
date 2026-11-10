import { describe, expect, test } from "vitest";
import { safeRedirect } from "./redirect";

const O = "http://localhost:3000";
describe("safeRedirect (open-redirect guard)", () => {
  test("keeps same-origin paths with query and hash", () => {
    expect(safeRedirect("/settings?tab=a#privacy", O)).toBe("/settings?tab=a#privacy");
    expect(safeRedirect("/%0d%0a", O)).toBe("/%0d%0a"); // encoded text stays a harmless same-origin path
  });
  test("rejects external, protocol-relative, backslash and control-character values", () => {
    for (const bad of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\u0000x",
      "/\nevil",
      "javascript:alert(1)",
    ]) {
      expect(safeRedirect(bad, O), JSON.stringify(bad)).toBe("/home");
    }
  });
});
