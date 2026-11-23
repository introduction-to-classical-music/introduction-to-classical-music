import { describe, expect, it } from "vitest";

import { emphasizeHtml, escapeHtmlText } from "@/lib/directory-emphasis";

describe("directory name emphasis escaping (F06)", () => {
  it("escapes HTML before inserting strong markup", () => {
    const html = emphasizeHtml("Alice <script>alert(1)</script>", "Alice");

    expect(html).toContain("<strong>Alice</strong>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;/script&gt;");
  });

  it("escapes the highlight itself", () => {
    const html = emphasizeHtml("<img src=x onerror=alert(2)>", "<img src=x onerror=alert(2)>");

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>&lt;img");
  });

  it("escapes quotes, ampersands and angle brackets", () => {
    expect(escapeHtmlText(`A & B < C > D "E" 'F'`)).toBe(
      "A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;",
    );
  });

  it("wraps every occurrence of the highlight", () => {
    expect(emphasizeHtml("Bach & Bach", "Bach")).toBe("<strong>Bach</strong> &amp; <strong>Bach</strong>");
  });

  it("returns escaped text when the highlight is missing or empty", () => {
    expect(emphasizeHtml("<b>Bach</b>", "")).toBe("&lt;b&gt;Bach&lt;/b&gt;");
    expect(emphasizeHtml("<b>Bach</b>", "Mozart")).toBe("&lt;b&gt;Bach&lt;/b&gt;");
    expect(emphasizeHtml("", "Bach")).toBe("");
  });

  it("handles ampersands in both value and highlight", () => {
    const html = emphasizeHtml("HKO & RO", "HKO & RO");
    expect(html).toBe("<strong>HKO &amp; RO</strong>");
  });

  it("keeps ordinary names and highlights unchanged", () => {
    expect(emphasizeHtml("Ludwig van Beethoven", "Beethoven")).toBe(
      "Ludwig van <strong>Beethoven</strong>",
    );
  });
});
