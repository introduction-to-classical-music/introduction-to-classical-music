import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

let tempRoot = "";
let libraryRoot = "";
let registeredFile = "";
let server: http.Server | null = null;
let port = 0;
let cookie = "";
const openedTargets: string[] = [];

type RawResponse = {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function rawRequest(
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string; withCookie?: boolean } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (options.withCookie !== false && cookie) {
      headers.cookie = cookie;
    }
    const request = http.request(
      { host: "127.0.0.1", port, method: options.method || "GET", path: options.path || "/", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

function jsonRequest(pathname: string, body: unknown) {
  return rawRequest({
    method: "POST",
    path: pathname,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookieFrom(response: RawResponse) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const session = values.find((value) => value.startsWith("icm_owner_session="));
  if (!session) {
    throw new Error("missing owner session cookie");
  }
  return session.split(";")[0];
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-owner-hardening-"));
  libraryRoot = path.join(tempRoot, "library");
  registeredFile = path.join(tempRoot, "music", "registered.flac");
  await mkdir(path.dirname(registeredFile), { recursive: true });
  await writeFile(registeredFile, "audio", "utf8");

  process.env.ICM_REPO_ROOT = process.cwd();
  process.env.ICM_RUNTIME_MODE = "bundle";
  process.env.ICM_ACTIVE_LIBRARY_DIR = libraryRoot;
  process.env.ICM_APP_DATA_DIR = path.join(tempRoot, "appdata");

  const { ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
  const { saveLibraryToDisk } = await import("../../packages/data-core/src/library-store.ts");
  const { validateLibrary } = await import("../../packages/shared/src/schema.ts");
  await ensureLibraryBundle(libraryRoot, { libraryName: "W3 hardening" });
  await saveLibraryToDisk(
    validateLibrary({
      composers: [
        {
          id: "composer-1",
          slug: "composer-1",
          name: "贝多芬",
          fullName: "贝多芬",
          nameLatin: "Ludwig van Beethoven",
          country: "Germany",
          avatarSrc: "",
          aliases: [],
          sortKey: "0010",
          summary: "",
        },
      ],
      people: [],
      workGroups: [
        { id: "group-1", composerId: "composer-1", title: "管弦乐", slug: "orchestral", path: ["管弦乐"], sortKey: "0010" },
      ],
      works: [
        {
          id: "work-1",
          composerId: "composer-1",
          groupIds: ["group-1"],
          slug: "work-1",
          title: "作品一",
          titleLatin: "",
          aliases: [],
          catalogue: "",
          summary: "",
          sortKey: "0010",
          updatedAt: "2026-03-21T00:00:00.000Z",
        },
      ],
      recordings: [
        {
          id: "recording-1",
          workId: "work-1",
          slug: "recording-1",
          title: "Recording",
          workTypeHint: "orchestral",
          sortKey: "0010",
          isPrimaryRecommendation: false,
          updatedAt: "2026-03-21T00:00:00.000Z",
          images: [],
          credits: [],
          links: [
            {
              platform: "local",
              url: "",
              localPath: registeredFile,
              title: "Registered local file",
              linkType: "local",
              visibility: "local-only",
            },
          ],
          notes: "",
          performanceDateText: "",
          venueText: "",
          albumTitle: "",
          label: "",
          releaseDate: "",
          infoPanel: { text: "", articleId: "", collectionLinks: [] },
          legacyPath: "",
        },
      ],
    }),
  );

  const { createOwnerApp } = await import("../../apps/owner/server/owner-app.ts");
  const app = createOwnerApp({
    bootstrapToken: "hardening-token",
    port: 0,
    openTarget: async (target: string) => {
      openedTargets.push(String(target));
    },
    resolveHostAddresses: async (hostname: string) =>
      hostname.includes("internal") ? ["10.0.0.5"] : ["93.184.216.34"],
    fetchImpl: async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("html")) {
        return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href.includes("big")) {
        return new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;

  const bootstrap = await rawRequest({ path: "/?bootstrap=hardening-token", withCookie: false });
  cookie = sessionCookieFrom(bootstrap);
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  await rm(tempRoot, { recursive: true, force: true });
});

describe("owner API hardening (W3)", () => {
  it("requires a session before reaching hardened routes", async () => {
    const unauthenticated = await rawRequest({ path: "/api/remote-image?url=https://x.test/a.png", withCookie: false });
    expect(unauthenticated.status).toBe(401);
  });

  it("blocks remote-image requests to private hosts and non-image responses", async () => {
    const privateHost = await rawRequest({
      path: `/api/remote-image?url=${encodeURIComponent("http://internal.example.test/x.png")}`,
    });
    expect(privateHost.status).toBe(400);
    expect(privateHost.body).toContain("not allowed");

    const good = await rawRequest({
      path: `/api/remote-image?url=${encodeURIComponent("https://images.example.test/x.png")}`,
    });
    expect(good.status).toBe(200);
    expect(String(good.headers["content-type"] || "")).toContain("image/png");
    expect(Buffer.from(good.body, "binary").length).toBe(3);

    const html = await rawRequest({
      path: `/api/remote-image?url=${encodeURIComponent("https://images.example.test/page.html")}`,
    });
    expect(html.status).toBe(400);
    expect(html.body).toContain("Unsupported remote image content type");
  });

  it("rejects traversal buckets and non-image uploads, accepts a safe upload", async () => {
    const traversal = await jsonRequest("/api/assets/upload", {
      bucket: "../escape",
      slug: "asset",
      fileName: "cover.jpg",
      contentBase64: "aGVsbG8=",
    });
    expect(traversal.status).toBe(400);
    expect(traversal.body).toContain("Unsupported asset bucket");

    const badExtension = await jsonRequest("/api/assets/upload", {
      bucket: "misc",
      slug: "asset",
      fileName: "payload.exe",
      contentBase64: "aGVsbG8=",
    });
    expect(badExtension.status).toBe(400);
    expect(badExtension.body).toContain("Unsupported asset extension");

    const valid = await jsonRequest("/api/assets/upload", {
      bucket: "misc",
      slug: "w3-asset",
      fileName: "cover.png",
      contentBase64: "aGVsbG8=",
    });
    expect(valid.status).toBe(200);
    const src = JSON.parse(valid.body).asset.src as string;
    expect(src.startsWith("/library-assets/managed/misc/")).toBe(true);
    const managedDirs = await readdir(path.join(libraryRoot, "assets", "managed", "misc"), { recursive: true });
    expect(managedDirs.some((entry) => String(entry).endsWith(".png"))).toBe(true);
    expect(existsSync(path.join(libraryRoot, "assets", "managed", "misc"))).toBe(true);
  });

  it("rejects empty and unregistered local paths, opens a registered one", async () => {
    const empty = await jsonRequest("/api/open-resource", { linkType: "local", localPath: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body).toContain("Missing localPath");

    const outsidePath = path.join(tempRoot, "outside.flac");
    await writeFile(outsidePath, "audio", "utf8");
    const outside = await jsonRequest("/api/open-resource", { linkType: "local", localPath: outsidePath });
    expect(outside.status).toBe(400);
    expect(outside.body).toContain("not registered");

    openedTargets.length = 0;
    const registered = await jsonRequest("/api/open-resource", { linkType: "local", localPath: registeredFile });
    expect(registered.status).toBe(200);
    expect(JSON.parse(registered.body).opened).toBe(true);
    expect(openedTargets).toEqual([path.resolve(registeredFile)]);

    const unsupportedExternal = await jsonRequest("/api/open-resource", {
      linkType: "external",
      url: "file:///C:/Windows/System32/calc.exe",
    });
    expect(unsupportedExternal.status).toBe(400);
    expect(unsupportedExternal.body).toContain("Unsupported url protocol");
  });

  it("protects the site export destination (root path / non-empty directory)", async () => {
    const driveRoot = await jsonRequest("/api/library/export-site", { destinationPath: "C:\\" });
    expect(driveRoot.status).toBe(400);
    const driveRootPayload = JSON.parse(driveRoot.body);
    expect(driveRootPayload.code).toBe("destination-root");

    const nonEmptyDir = path.join(tempRoot, "non-empty-site");
    await mkdir(nonEmptyDir, { recursive: true });
    await writeFile(path.join(nonEmptyDir, "old.html"), "old", "utf8");
    const nonEmpty = await jsonRequest("/api/library/export-site", { destinationPath: nonEmptyDir });
    expect(nonEmpty.status).toBe(409);
    const nonEmptyPayload = JSON.parse(nonEmpty.body);
    expect(nonEmptyPayload.needsOverwrite).toBe(true);
    expect(existsSync(path.join(nonEmptyDir, "old.html"))).toBe(true);
  });
});
