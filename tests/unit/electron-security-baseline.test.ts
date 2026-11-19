import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readSource(relativePath: string) {
  return readFile(path.resolve(relativePath), "utf8");
}

function exposedMethods(preloadSource: string): string[] {
  return [...preloadSource.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
}

describe("Electron security baseline (release S4 + C-F13)", () => {
  it("enables sandbox while keeping contextIsolation/webSecurity and nodeIntegration disabled", async () => {
    const main = await readSource("apps/desktop/main.ts");
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).not.toMatch(/sandbox:\s*false/);
  });

  it("splits the preload bridge per window and keeps the minimal method sets", async () => {
    const launcher = await readSource("apps/desktop/preload-launcher.ts");
    const owner = await readSource("apps/desktop/preload-owner.ts");
    const site = await readSource("apps/desktop/preload-site.ts");
    expect(exposedMethods(launcher)).toEqual([
      "getLibraryStatus", "openLibrary", "openOwner", "openRetrieval", "importLibrary",
      "exportLibrary", "chooseExportFormat", "openLibraryFolder", "windowControl",
    ]);
    expect(exposedMethods(owner)).toEqual([
      "openLibrary", "activateLibrary", "renameLibrary", "openLocalResource",
      "pickLibraryFolder", "pickDirectory", "pickLocalResourceFile",
    ]);
    expect(exposedMethods(site)).toEqual(["openLocalResource"]);
    for (const source of [launcher, owner, site]) {
      expect(source).toContain("contextBridge.exposeInMainWorld");
      expect(source).not.toMatch(/require\(/);
      expect(source).not.toMatch(/process\./);
      expect(source).not.toMatch(/webUtils|shell\.|nodeIntegration/);
    }
  });

  it("passes a window-specific preload to each window and none to retrieval", async () => {
    const main = await readSource("apps/desktop/main.ts");
    expect(main).toContain('path.join(desktopPreloadDir, "preload-launcher.js")');
    expect(main).toContain('path.join(desktopPreloadDir, "preload-owner.js")');
    expect(main).toContain('path.join(desktopPreloadDir, "preload-site.js")');
    expect(main).not.toMatch(/"preload\.js"/);
    const createWindowCalls = [...main.matchAll(/createWindow\(\s*\{[\s\S]*?\}\s*,\s*([^)]+)?\)/g)];
    expect(createWindowCalls.length).toBeGreaterThanOrEqual(4);
    expect(main).toMatch(/retrievalWindow = createWindow\([\s\S]*?\},\s*null,\s*\);/);
  });

  it("validates IPC sender windows for every handler (fail-closed)", async () => {
    const main = await readSource("apps/desktop/main.ts");
    expect(main).toContain("function assertIpcSenderWindow(");
    expect(main).toContain('kind === "retrieval"');
    const channels = [...main.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((match) => match[1]);
    expect(channels.length).toBe(16);
    for (const channel of channels) {
      const index = main.indexOf(`ipcMain.handle("${channel}"`);
      const window = main.slice(index, index + 400);
      expect(window, channel).toContain(`assertIpcSenderWindow(event`);
    }
    // launcher-only channels must not accept owner/site/retrieval senders.
    expect(main).toMatch(/assertIpcSenderWindow\(event, \["launcher"\], "launcher:window-control"\)/);
    expect(main).toMatch(/assertIpcSenderWindow\(event, \["launcher", "owner", "library"\], "desktop:open-local-resource"\)/);
  });
});
