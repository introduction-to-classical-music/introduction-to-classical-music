import { describe, expect, it } from "vitest";

import { redactSensitiveText } from "../../packages/shared/src/redact.ts";

describe("log/error redaction (release S8)", () => {
  it("masks API keys, bearer tokens and session/bootstrap tokens", () => {
    const text = redactSensitiveText(
      'apiKey="sk-secret-value" Authorization: Bearer abcdefghijklmnop token=session-12345678 bootstrap=OWNER-TOKEN-123',
    );
    expect(text).not.toContain("sk-secret-value");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("session-12345678");
    expect(text).not.toContain("OWNER-TOKEN-123");
    expect(text).toContain("[redacted]");
  });

  it("masks Windows and POSIX home absolute paths", () => {
    const text = redactSensitiveText(
      "open F:\\personal\\Sunhaoran\\Introduction to Classical Music\\data and /Users/alice/private/x and /home/bob/.config",
    );
    expect(text).not.toContain("Sunhaoran");
    expect(text).not.toContain("alice");
    expect(text).not.toContain("bob");
    expect(text).toContain("<local-path>");
  });

  it("masks emails and QQ contact values", () => {
    const text = redactSensitiveText("contact alice@example.com QQ: 123456789");
    expect(text).not.toContain("alice@example.com");
    expect(text).not.toContain("123456789");
  });

  it("leaves ordinary diagnostics untouched", () => {
    expect(redactSensitiveText("job accepted at port 4780")).toBe("job accepted at port 4780");
  });
});
