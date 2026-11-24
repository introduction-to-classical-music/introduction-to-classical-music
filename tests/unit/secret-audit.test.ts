import { describe, expect, it } from "vitest";

import {
  SECRET_RULES,
  formatFinding,
  looksLikePlaceholder,
  maskSecret,
  scanRepository,
  scanText,
} from "../../scripts/audit-secrets.mjs";

// Fake values are assembled at runtime on purpose: this test file is itself
// tracked, so it must not contain a literal string that the scanner would flag.
const fakeApiKey = `sk-${"a1b2c3d4e5f6".repeat(2)}`;
const fakeAssignmentValue = "Zx9" + "Qw8Er7Ty6Ui5Op4As3".repeat(2);
const fakeBearerToken = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0";
const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnopqrstuvwxyz"].join(".");
const fakeGithubToken = `ghp_${"0123456789abcdefghij".repeat(2)}`;
const fakeAwsKeyId = `AKIA${"0123456789ABCDEF"}`;
const fakePrivateKeyHeader = `-----BEGIN ${"RSA "}PRIVATE KEY-----`;

function ruleIds(text: string) {
  return scanText(text).map((finding) => finding.rule);
}

describe("secret pattern matching", () => {
  it("exposes unique rule ids", () => {
    const ids = SECRET_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ["sk-prefixed API key", `const key = "${fakeApiKey}";`, "sk-api-key"],
    ["apiKey assignment", `const config = { apiKey: "${fakeAssignmentValue}" };`, "api-key-assignment"],
    ["environment-style assignment", `API_KEY=${fakeAssignmentValue}`, "env-secret-assignment"],
    ["Authorization bearer token", `headers: { Authorization: Bearer ${fakeBearerToken} }`, "authorization-bearer"],
    ["JWT token", `token = "${fakeJwt}";`, "jwt"],
    ["GitHub token", `GITHUB_TOKEN=${fakeGithubToken}`, "github-token"],
    ["AWS access key id", `aws_access_key_id = "${fakeAwsKeyId}"`, "aws-access-key-id"],
    ["private key block", fakePrivateKeyHeader, "private-key-block"],
  ])("detects %s", (_label, text, expectedRule) => {
    expect(ruleIds(text)).toContain(expectedRule);
  });

  it("reports the source line number of a finding", () => {
    const text = ["first line", "second line", `const key = "${fakeApiKey}";`].join("\n");
    const [finding] = scanText(text, "sample.ts");
    expect(finding.file).toBe("sample.ts");
    expect(finding.line).toBe(3);
  });

  it("accepts placeholders, examples and short values", () => {
    const benign = [
      'const config = { apiKey: "your-secret" };',
      'const config = { apiKey: "" };',
      'const config = { apiKey: "YOUR_YOUTUBE_DATA_API_KEY" };',
      'const config = { apiKey: "<replace-with-real-key>" };',
      'const config = { developerToken: "YOUR_APPLE_MUSIC_DEVELOPER_TOKEN" };',
      "sk-short",
      "plain documentation text without credentials",
    ];
    for (const text of benign) {
      expect(scanText(text)).toEqual([]);
    }
  });

  it("ignores values that only look like assignments in normal code", () => {
    const benign = [
      'baseUrl: process.env.LLM_BASE_URL || ""',
      "apiKey: loadApiKey(configPath)",
      "const apiKey = getApiKeyFromEnvironment();",
      'headers: { Authorization: "Bearer " + token }',
    ];
    for (const text of benign) {
      expect(scanText(text)).toEqual([]);
    }
  });
});

describe("secret masking", () => {
  it("never returns the full secret value", () => {
    const masked = maskSecret(fakeApiKey);
    expect(masked).not.toContain(fakeApiKey);
    expect(masked).toContain("***[redacted");
    expect(masked).toContain("sk-");
  });

  it("masks the value inside findings and formatted output", () => {
    const [finding] = scanText(`const key = "${fakeApiKey}";`, "sample.ts");
    expect(finding.masked).not.toContain(fakeApiKey);
    expect(finding.excerpt).not.toContain(fakeApiKey);
    const formatted = formatFinding(finding, "working-tree");
    expect(formatted).not.toContain(fakeApiKey);
    expect(formatted).toContain("[working-tree]");
    expect(formatted).toContain("sample.ts:1");
  });

  it("classifies placeholder-looking values", () => {
    expect(looksLikePlaceholder("YOUR_TOKEN")).toBe(true);
    expect(looksLikePlaceholder("<redacted>")).toBe(true);
    expect(looksLikePlaceholder("sk-live-9f8e7d6c5b4a")).toBe(false);
  });
});

describe("scanRepository", () => {
  it("scans the current repository without findings", async () => {
    const result = scanRepository({ cwd: process.cwd() });
    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.findings.map((finding) => `${finding.file}:${finding.line}`)).toEqual([]);
  });
});
