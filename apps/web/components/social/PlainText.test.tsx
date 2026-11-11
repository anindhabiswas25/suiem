import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PlainText, safeHref } from "./PlainText";

const render = (text: string) => renderToStaticMarkup(<PlainText text={text} />);

describe("XSS: user content renders inert", () => {
  test("<script> is escaped text", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  test("img onerror is escaped text", () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;img");
  });
  test("javascript:, data: and vbscript: URLs are never links", () => {
    for (const p of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
      const html = render(`click ${p}`);
      expect(html).not.toContain("<a");
      expect(html).not.toMatch(/href=/i);
    }
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });
  test("an http(s) URL with an injected quote can't break out of the attribute", () => {
    const html = render('see https://example.com/"onmouseover="alert(1) now');
    expect(html).toContain('href="https://example.com/"');
    expect(html).not.toMatch(/onmouseover="alert/);
  });
  test("http(s) links get rel=nofollow noopener and open in a new tab", () => {
    const html = render("Source: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany.");
    expect(html).toContain('<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"');
    expect(html).toContain('rel="nofollow noopener noreferrer ugc"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/<\/a>\.<\/p>$/);
  });
  test("markdown and HTML entities stay literal", () => {
    const html = render("[x](javascript:alert(1)) &amp; **bold**");
    expect(html).not.toContain("<a");
    expect(html).toContain("&amp;amp;");
  });
});
