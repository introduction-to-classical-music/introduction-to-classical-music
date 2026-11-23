import express from "express";
import type { Server } from "node:http";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";

async function findAvailablePort(preferredPort: number, options: { maxAttempts?: number; host?: string } = {}) {
  const host = options.host || "127.0.0.1";
  const maxAttempts = options.maxAttempts || 256;
  let port = preferredPort;
  let attempts = 0;
  while (port <= 65535 && attempts <= maxAttempts) {
    const available = await new Promise<boolean>((resolve) => {
      const tester = net.createServer();
      tester.once("error", () => resolve(false));
      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });
      tester.listen(port, host);
    });
    if (available) {
      return port;
    }
    port += 1;
    attempts += 1;
  }
  throw new Error(`No available port found in range starting from ${preferredPort}`);
}

export function createLocalSiteServer(options: {
  host?: string;
  preferredPort?: number;
} = {}) {
  const host = options.host || "127.0.0.1";
  const preferredPort = options.preferredPort || 4331;
  let server: Server | null = null;
  let url = "";
  let rootDir = "";

  return {
    async ensureStarted(nextRootDir: string) {
      const resolvedRootDir = path.resolve(nextRootDir);
      await fs.access(path.join(resolvedRootDir, "index.html"));
      if (server && rootDir === resolvedRootDir) {
        return { url, rootDir };
      }

      if (server) {
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        server = null;
      }

      const port = await findAvailablePort(preferredPort);
      const app = express();
      // Release S5: security headers for the local site. Astro pages use inline
      // styles and inline module scripts, so the CSP allows those but forbids
      // framing, objects and cross-origin subresources; no eval is allowed.
      app.use((_request, response, next) => {
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
        response.setHeader("X-Frame-Options", "DENY");
        next();
      });
      // W3/D3-A: the old `/__local-resource` endpoint (which opened arbitrary
      // paths on GET, a same-origin side effect) is intentionally gone. Local
      // resource links are opened by the Electron IPC bridge instead; in a
      // plain browser the site script shows an "desktop app only" hint.
      app.use(express.static(resolvedRootDir));
      app.get(/.*/, (_request, response) => {
        response.sendFile(path.join(resolvedRootDir, "index.html"));
      });

      server = app.listen(port, host);
      await once(server, "listening");
      rootDir = resolvedRootDir;
      url = `http://${host}:${port}`;
      return { url, rootDir };
    },
    async stop() {
      if (!server) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = null;
      url = "";
      rootDir = "";
    },
    getState() {
      return {
        running: Boolean(server),
        url,
        rootDir,
      };
    },
  };
}
