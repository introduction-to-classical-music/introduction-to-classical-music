import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

async function canBindLoopbackPort() {
  const probe = http.createServer();
  return await new Promise<boolean>((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(0, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function getFreeLoopbackPort() {
  const probe = net.createServer();
  return await new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

afterEach(async () => {
  vi.resetModules();
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("local site server", () => {
  it("serves a built site directory over a local http url", async () => {
    if (!(await canBindLoopbackPort())) {
      return;
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-local-site-"));
    tempDirs.push(tempRoot);
    const siteRoot = path.join(tempRoot, "build", "site");
    await mkdir(siteRoot, { recursive: true });
    await writeFile(path.join(siteRoot, "index.html"), "<!doctype html><title>Library</title>", "utf8");

    const { createLocalSiteServer } = await import("../../packages/data-core/src/local-site-server.ts");
    const server = createLocalSiteServer({ preferredPort: await getFreeLoopbackPort() });
    const started = await server.ensureStarted(siteRoot);
    const response = await fetch(started.url);
    const html = await response.text();
    await server.stop();

    expect(response.ok).toBe(true);
    expect(html).toContain("<title>Library</title>");
  });

  it("no longer exposes a same-origin side-effect endpoint for local paths", async () => {
    if (!(await canBindLoopbackPort())) {
      return;
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-local-site-"));
    tempDirs.push(tempRoot);
    const siteRoot = path.join(tempRoot, "build", "site");
    await mkdir(siteRoot, { recursive: true });
    await writeFile(path.join(siteRoot, "index.html"), "<!doctype html><title>Library</title>", "utf8");

    const { createLocalSiteServer } = await import("../../packages/data-core/src/local-site-server.ts");
    const server = createLocalSiteServer({ preferredPort: await getFreeLoopbackPort() });
    const started = await server.ensureStarted(siteRoot);
    const response = await fetch(`${started.url}/__local-resource?path=${encodeURIComponent(path.join(tempRoot, "x.mp3"))}`);
    const body = await response.text();
    await server.stop();

    // The SPA fallback may serve index.html, but nothing is opened and no
    // "opened" side effect page exists anymore.
    expect(body).not.toContain("Local resource opened.");
    expect(body.toLowerCase()).toContain("<title>library</title>");
  });
});
