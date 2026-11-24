import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWindowsDpapiProtector,
  protectSecret,
  setSecretProtectorForTests,
  unprotectSecret,
} from "../../packages/automation/src/secret-protector.ts";

const tempDirs: string[] = [];
const fakeProtector = {
  async protect(plaintext: string) {
    return `FAKE:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  },
  async unprotect(ciphertext: string) {
    if (!ciphertext.startsWith("FAKE:")) {
      throw new Error("bad ciphertext");
    }
    return Buffer.from(ciphertext.slice(5), "base64").toString("utf8");
  },
};

afterEach(async () => {
  setSecretProtectorForTests(null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "classical-dpapi-"));
  tempDirs.push(dir);
  return dir;
}

describe("desktop LLM secret protector (C-F07 / release S2)", () => {
  it("round-trips a versioned DPAPI envelope with an injected protector", async () => {
    setSecretProtectorForTests(fakeProtector);
    const envelope = await protectSecret('{"apiKey":"secret-key"}');
    expect(envelope.schemaVersion).toBe("dpapi-v1");
    expect(envelope.scope).toBe("CurrentUser");
    expect(JSON.stringify(envelope)).not.toContain("secret-key");
    await expect(unprotectSecret(envelope)).resolves.toBe('{"apiKey":"secret-key"}');
  });

  it("fails closed on non-Windows without an injected protector", async () => {
    if (process.platform === "win32") {
      return;
    }
    expect(() => createWindowsDpapiProtector()).toThrow(/unavailable/);
    await expect(protectSecret("secret")).rejects.toThrow(/DPAPI/);
  });

  it("encrypts desktop LLM settings on disk and migrates legacy plaintext", async () => {
    const appData = await tempDir();
    process.env.ICM_REPO_ROOT = process.cwd();
    process.env.ICM_RUNTIME_MODE = "bundle";
    process.env.ICM_APP_DATA_DIR = appData;
    process.env.ICM_ACTIVE_LIBRARY_DIR = path.join(appData, "library");
    setSecretProtectorForTests(fakeProtector);
    const { getRuntimePaths } = await import("../../packages/data-core/src/app-paths.ts");
    const { saveLlmConfig, loadLlmConfig } = await import("../../packages/automation/src/automation-store.ts");
    const secretsPath = getRuntimePaths().appData.secretsPath;
    const config = { enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret-key", model: "m", timeoutMs: 1000 };
    await saveLlmConfig(config);
    const savedText = await readFile(secretsPath, "utf8");
    expect(savedText).toContain("dpapi-v1");
    expect(savedText).not.toContain("secret-key");
    await expect(loadLlmConfig()).resolves.toMatchObject({ apiKey: "secret-key" });

    // Legacy plaintext file (older builds) is migrated in place.
    await writeFile(secretsPath, JSON.stringify(config), "utf8");
    await expect(loadLlmConfig()).resolves.toMatchObject({ apiKey: "secret-key" });
    const migratedText = await readFile(secretsPath, "utf8");
    expect(migratedText).toContain("dpapi-v1");
    expect(migratedText).not.toContain("secret-key");
  }, 120000);
});
