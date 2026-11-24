import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

const servers: http.Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

async function startOwnerApp(options = {}) {
  const { createOwnerApp } = await import("../../apps/owner/server/owner-app.ts");
  const app = createOwnerApp(options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { port: address.port, app };
}

type RawResponse = {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function rawRequest(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method || "GET",
        path: options.path || "/",
        headers: options.headers || {},
      },
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

function sessionCookieFrom(response: RawResponse) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const session = values.find((value) => value.startsWith("icm_owner_session="));
  if (!session) {
    throw new Error(`missing session cookie in ${JSON.stringify(values)}`);
  }
  return session.split(";")[0];
}

async function bootstrapSession(port: number, token: string) {
  const response = await rawRequest(port, { path: `/?bootstrap=${encodeURIComponent(token)}` });
  return { response, cookie: sessionCookieFrom(response) };
}

describe("owner service auth (W3 / D3-A)", () => {
  it("derives a stable bootstrap token from the environment or generates 256-bit random tokens", async () => {
    const { createOwnerApp, resolveOwnerBootstrapToken, formatOwnerBootstrapUrl } = await import(
      "../../apps/owner/server/owner-app.ts"
    );

    expect(resolveOwnerBootstrapToken({ ICM_OWNER_BOOTSTRAP_TOKEN: "env-token" })).toBe("env-token");
    const generated = resolveOwnerBootstrapToken({});
    expect(generated).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveOwnerBootstrapToken({})).not.toBe(generated);
    expect(formatOwnerBootstrapUrl("http://127.0.0.1:4322/", "abc")).toBe(
      "http://127.0.0.1:4322/?bootstrap=abc",
    );
    expect(typeof createOwnerApp).toBe("function");
  });

  it("rejects API calls without a session and accepts the bootstrap cookie", async () => {
    const token = "test-bootstrap-token";
    const { port } = await startOwnerApp({ bootstrapToken: token, port: 0 });

    const unauthenticatedGet = await rawRequest(port, { path: "/api/does-not-exist" });
    expect(unauthenticatedGet.status).toBe(401);
    const unauthenticatedPost = await rawRequest(port, { method: "POST", path: "/api/does-not-exist" });
    expect(unauthenticatedPost.status).toBe(401);

    const badBootstrap = await rawRequest(port, { path: "/?bootstrap=wrong-token" });
    expect(badBootstrap.status).toBe(401);

    const { response: goodBootstrap, cookie } = await bootstrapSession(port, token);
    expect(goodBootstrap.status).toBe(302);
    expect(goodBootstrap.headers.location).toBe("/");
    const setCookie = String(goodBootstrap.headers["set-cookie"] || "");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("icm_owner_session=");

    const authenticatedGet = await rawRequest(port, {
      path: "/api/does-not-exist",
      headers: { cookie },
    });
    expect(authenticatedGet.status).toBe(404);

    const authenticatedPost = await rawRequest(port, {
      method: "POST",
      path: "/api/does-not-exist",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(authenticatedPost.status).toBe(404);
  });

  it("rejects forged Host headers (DNS rebinding)", async () => {
    const { port } = await startOwnerApp({ bootstrapToken: "host-token", port: 0 });
    const { cookie } = await bootstrapSession(port, "host-token");

    const forgedHost = await rawRequest(port, {
      path: "/api/does-not-exist",
      headers: { host: "attacker.example:4322", cookie },
    });
    expect(forgedHost.status).toBe(403);

    const hostWithoutPort = await rawRequest(port, {
      path: "/api/does-not-exist",
      headers: { host: "127.0.0.1", cookie },
    });
    expect(hostWithoutPort.status).toBe(403);

    const staticWithForgedHost = await rawRequest(port, {
      path: "/",
      headers: { host: "attacker.example:4322" },
    });
    expect(staticWithForgedHost.status).toBe(403);
  });

  it("rejects cross-origin API calls (CSRF) while allowing same-origin requests", async () => {
    const token = "origin-token";
    const { port } = await startOwnerApp({ bootstrapToken: token, port: 0 });
    const { cookie } = await bootstrapSession(port, token);

    const crossOrigin = await rawRequest(port, {
      method: "POST",
      path: "/api/does-not-exist",
      headers: { origin: "http://attacker.example", cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);

    const sameOrigin = await rawRequest(port, {
      method: "POST",
      path: "/api/does-not-exist",
      headers: { origin: `http://127.0.0.1:${port}`, cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(sameOrigin.status).toBe(404);
  });

  it("serves the owner shell page but keeps APIs gated before bootstrap", async () => {
    const { port } = await startOwnerApp({ bootstrapToken: "shell-token", port: 0 });

    const shell = await rawRequest(port, { path: "/" });
    expect(shell.status).toBe(200);
    expect(shell.body.toLowerCase()).toContain("<html");

    const favicon = await rawRequest(port, { path: "/favicon.ico" });
    expect([200, 404]).toContain(favicon.status);
  });
});
