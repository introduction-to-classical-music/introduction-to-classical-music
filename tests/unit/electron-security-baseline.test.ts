import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readSource(relativePath: string) {
  return readFile(path.resolve(relativePath), "utf8");
}

describe("Electron security baseline (release S4)", () => {
  it("enables sandbox while keeping contextIsolation/webSecurity and nodeIntegration disabled", async () => {
    const main = await readSource("apps/desktop/main.ts");
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).not.toMatch(/sandbox:\s*false/);
  });

  it("keeps the preload bridge minimal (no ipcRenderer/process/require exposure)", async () => {
    const preload = await readSource("apps/desktop/preload.ts");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);
    expect(preload).not.toMatch(/require\(/);
    expect(preload).not.toMatch(/process\./);
    const exposedChannels = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((match) => match[1]);
    expect(exposedChannels.length).toBeGreaterThan(5);
    for (const channel of exposedChannels) {
      expect(channel).toMatch(/^(launcher|desktop):/);
    }
  });
});
