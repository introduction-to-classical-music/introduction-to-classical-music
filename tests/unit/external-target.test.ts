import { describe, expect, it } from "vitest";

import { isAllowedExternalTarget } from "../../packages/data-core/src/open-target.ts";

describe("external target protocol policy (W3)", () => {
  it.each([
    "https://www.youtube.com/watch?v=abc",
    "http://127.0.0.1:4331/about/",
    "mailto:maintainer@example.com",
  ])("allows %s", (target) => {
    expect(isAllowedExternalTarget(target)).toBe(true);
  });

  it.each([
    "file:///C:/Windows/System32/calc.exe",
    "file://server/share/file",
    "javascript:alert(1)",
    "smb://server/share",
    "\\\\server\\share\\file",
    "cmd.exe /c calc",
    "",
    "   ",
    "not a url",
  ])("rejects %s", (target) => {
    expect(isAllowedExternalTarget(target)).toBe(false);
  });
});
