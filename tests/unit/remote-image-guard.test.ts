import { describe, expect, it } from "vitest";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  assertRemoteImageUrlAllowed,
  fetchRemoteImage,
  isDisallowedRemoteAddress,
  isPublicRemoteAddress,
} from "../../packages/data-core/src/remote-image-guard.ts";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("remote image address policy (W3 / SSRF)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.0.1",
    "::ffff:169.254.169.254",
    "2001:db8::1",
  ])("blocks private/reserved address %s", (address) => {
    expect(isDisallowedRemoteAddress(address)).toBe(true);
    expect(isPublicRemoteAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isDisallowedRemoteAddress(address)).toBe(false);
      expect(isPublicRemoteAddress(address)).toBe(true);
    },
  );

  it("rejects non-IP input as untrusted", () => {
    expect(isDisallowedRemoteAddress("example.com")).toBe(true);
    expect(isDisallowedRemoteAddress("")).toBe(true);
  });

  it("validates URL protocol, credentials, literal private hosts and resolved hosts", async () => {
    await expect(assertRemoteImageUrlAllowed("file:///etc/passwd")).rejects.toThrow(/Unsupported image protocol/);
    await expect(assertRemoteImageUrlAllowed("http://user:pass@example.com/x.png")).rejects.toThrow(/credentials/);
    await expect(assertRemoteImageUrlAllowed("http://127.0.0.1/x.png")).rejects.toThrow(/not allowed/);
    await expect(assertRemoteImageUrlAllowed("http://[::1]/x.png")).rejects.toThrow(/not allowed/);
    await expect(
      assertRemoteImageUrlAllowed("http://images.example.test/x.png", {
        resolveHostAddresses: async () => ["10.0.0.5"],
      }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      assertRemoteImageUrlAllowed("http://images.example.test/x.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
      }),
    ).resolves.toBeTruthy();
  });
});

describe("remote image fetch guard (W3)", () => {
  it("returns bytes for an allowed public image", async () => {
    const result = await fetchRemoteImage("https://images.example.test/x.png", {
      resolveHostAddresses: async () => ["93.184.216.34"],
      fetchImpl: async () =>
        new Response(pngBytes, { status: 200, headers: { "content-type": "image/png; charset=binary" } }),
    });
    expect(result.contentType).toBe("image/png");
    expect([...result.bytes]).toEqual([...pngBytes]);
  });

  it("rejects non-image content types", async () => {
    await expect(
      fetchRemoteImage("https://images.example.test/x.html", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      }),
    ).rejects.toThrow(/Unsupported remote image content type/);
  });

  it("rejects responses larger than the configured cap", async () => {
    await expect(
      fetchRemoteImage("https://images.example.test/big.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        maxBytes: 8,
        fetchImpl: async () => new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "image/png" } }),
      }),
    ).rejects.toThrow(/too large/);

    await expect(
      fetchRemoteImage("https://images.example.test/declared.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        maxBytes: 1024,
        fetchImpl: async () =>
          new Response(pngBytes, {
            status: 200,
            headers: { "content-type": "image/png", "content-length": "4096" },
          }),
      }),
    ).rejects.toThrow(/too large/);
  });

  it("re-validates redirect targets that resolve to private addresses", async () => {
    const response = new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
    Object.defineProperty(response, "url", { value: "http://127.0.0.1/internal.png" });
    await expect(
      fetchRemoteImage("https://images.example.test/redirect.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => response,
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects hosts that resolve to a private address before fetching", async () => {
    let fetched = false;
    await expect(
      fetchRemoteImage("https://internal.example.test/x.png", {
        resolveHostAddresses: async () => ["192.168.0.10"],
        fetchImpl: async () => {
          fetched = true;
          return new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
        },
      }),
    ).rejects.toThrow(/not allowed/);
    expect(fetched).toBe(false);
  });

  it("does not issue a second request for a redirect to a private host (C-F06)", async () => {
    // A real loopback listener counts connections: a blind follow would connect.
    let connections = 0;
    const listener = http.createServer((_request, response) => {
      connections += 1;
      response.end("private");
    });
    listener.on("connection", () => {
      connections += 1;
    });
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const privatePort = (listener.address() as AddressInfo).port;
    const requestedUrls: string[] = [];
    try {
      await expect(
        fetchRemoteImage("https://images.example.test/redirect.png", {
          resolveHostAddresses: async () => ["93.184.216.34"],
          fetchImpl: async (input) => {
            requestedUrls.push(String(input));
            return new Response(null, {
              status: 302,
              headers: { location: `http://127.0.0.1:${privatePort}/internal.png` },
            });
          },
        }),
      ).rejects.toThrow(/not allowed/);
      expect(requestedUrls).toHaveLength(1);
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  it("follows validated public redirects manually and exposes the final URL", async () => {
    const requestedUrls: string[] = [];
    const redirectModes: Array<string | undefined> = [];
    const result = await fetchRemoteImage("https://images.example.test/redirect.png", {
      resolveHostAddresses: async () => ["93.184.216.34"],
      fetchImpl: async (input, init) => {
        requestedUrls.push(String(input));
        redirectModes.push(init?.redirect);
        if (requestedUrls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://cdn.example.test/final.png" },
          });
        }
        return new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
      },
    });
    expect(requestedUrls).toEqual([
      "https://images.example.test/redirect.png",
      "https://cdn.example.test/final.png",
    ]);
    expect(redirectModes).toEqual(["manual", "manual"]);
    expect(result.finalUrl).toBe("https://cdn.example.test/final.png");
    expect([...result.bytes]).toEqual([...pngBytes]);
  });

  it("rejects redirect chains longer than the configured limit", async () => {
    let requests = 0;
    await expect(
      fetchRemoteImage("https://images.example.test/loop.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => {
          requests += 1;
          return new Response(null, {
            status: 302,
            headers: { location: `https://images.example.test/hop-${requests}.png` },
          });
        },
      }),
    ).rejects.toThrow(/Too many remote image redirects \(max 5\)/);
    expect(requests).toBe(6);
  });

  it("rejects redirects without Location, with invalid Location, or with non-http(s) targets", async () => {
    await expect(
      fetchRemoteImage("https://images.example.test/missing.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => new Response(null, { status: 302 }),
      }),
    ).rejects.toThrow(/missing a Location/);

    await expect(
      fetchRemoteImage("https://images.example.test/invalid.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://[::bad" } }),
      }),
    ).rejects.toThrow(/invalid Location/);

    await expect(
      fetchRemoteImage("https://images.example.test/file.png", {
        resolveHostAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
      }),
    ).rejects.toThrow(/Unsupported image protocol/);
  });
});
