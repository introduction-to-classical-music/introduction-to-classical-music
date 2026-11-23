import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

async function read(relativePath: string) {
  return fs.readFile(path.resolve(relativePath), "utf8");
}

describe("local resource links over Electron IPC (W3)", () => {
  it("exposes an IPC bridge in preload and validates paths in the main process", async () => {
    const preload = await read("apps/desktop/preload.ts");
    const mainProcess = await read("apps/desktop/main.ts");

    expect(preload).toContain("openLocalResource");
    expect(preload).toContain("desktop:open-local-resource");
    expect(mainProcess).toContain('ipcMain.handle("desktop:open-local-resource"');
    expect(mainProcess).toContain("resolveAllowedLocalResourceTarget");
    expect(mainProcess).toContain("collectRegisteredLocalResourcePaths");
    expect(mainProcess).toContain("shell.openPath");
  });

  it("renders local links as IPC-triggered controls without an HTTP endpoint", async () => {
    const infoPanel = await read("apps/site/src/components/EntityInfoPanel.astro");
    const recordingPage = await read("apps/site/src/pages/recordings/[id].astro");
    const layout = await read("apps/site/src/layouts/BaseLayout.astro");
    const resourceLinks = await read("packages/data-core/src/resource-links.ts");
    const localSiteServer = await read("packages/data-core/src/local-site-server.ts");

    for (const component of [infoPanel, recordingPage]) {
      expect(component).toContain("data-local-resource-link");
      expect(component).toContain("data-local-resource-path");
    }
    expect(layout).toContain("openLocalResource");
    expect(layout).toContain("desktopLauncher");
    expect(layout).not.toContain("fetch(trigger.href");
    expect(layout).toContain("仅可在「不全书」桌面应用中打开");

    // The same-origin side-effect endpoint is gone from both producer and server.
    expect(resourceLinks).not.toContain("__local-resource?path=");
    expect(localSiteServer).not.toContain('app.get("/__local-resource"');
  });
});
