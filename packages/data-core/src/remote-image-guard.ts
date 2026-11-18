import { promises as dns } from "node:dns";
import net from "node:net";

/**
 * SSRF guard for `/api/remote-image` (W3 / A3).
 *
 * The owner server fetches user-supplied image URLs. Before any network access
 * the hostname is resolved and every address is checked against loopback /
 * private / link-local / multicast / reserved ranges (IPv4 and IPv6, including
 * IPv4-mapped IPv6). Redirects are re-validated, and the response body is
 * bounded by size, content type and an independent timeout.
 */
export type RemoteImageGuardOptions = {
  fetchImpl?: typeof fetch;
  resolveHostAddresses?: (hostname: string) => Promise<string[]>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedContentTypes?: string[];
};

export const DEFAULT_REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 15000;
export const DEFAULT_REMOTE_IMAGE_MAX_REDIRECTS = 5;
export const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308] as const;
export const DEFAULT_REMOTE_IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

function ipv4ToInt(address: string) {
  const [a, b, c, d] = address.split(".").map((part) => Number(part));
  if (![a, b, c, d].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return null;
  }
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isDisallowedIPv4(address: string) {
  const value = ipv4ToInt(address);
  if (value === null) {
    return true;
  }
  const inRange = (network: string, prefix: number) => {
    const networkValue = ipv4ToInt(network);
    if (networkValue === null) {
      return false;
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (networkValue & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "this network"
    inRange("10.0.0.0", 8) || // private
    inRange("100.64.0.0", 10) || // carrier-grade NAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local
    inRange("172.16.0.0", 12) || // private
    inRange("192.0.0.0", 24) || // IETF protocol assignments
    inRange("192.0.2.0", 24) || // documentation
    inRange("192.168.0.0", 16) || // private
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("198.51.100.0", 24) || // documentation
    inRange("203.0.113.0", 24) || // documentation
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) || // reserved
    address === "255.255.255.255"
  );
}

function expandIPv6(address: string): number[] | null {
  const normalized = address.split("%")[0].toLowerCase();
  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parseGroups = (value: string) => (value ? value.split(":").filter(Boolean) : []);
  let groups: string[];
  if (halves.length === 2) {
    const head = parseGroups(halves[0]);
    const tail = parseGroups(halves[1]);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) {
      return null;
    }
    groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  } else {
    groups = parseGroups(normalized);
  }
  if (groups.length !== 8) {
    return null;
  }
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      return null;
    }
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function isDisallowedIPv6(address: string) {
  const bytes = expandIPv6(address);
  if (!bytes) {
    return true;
  }
  const isZeroPrefix = (length: number) => bytes.slice(0, length).every((value) => value === 0);
  const allZero = bytes.every((value) => value === 0);
  if (allZero) {
    return true; // :: unspecified
  }
  const isLoopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  if (isLoopback) {
    return true; // ::1
  }
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
  if (isZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isDisallowedIPv4(bytes.slice(12).join("."));
  }
  if (isZeroPrefix(12) && bytes.slice(12).some((value) => value !== 0)) {
    return isDisallowedIPv4(bytes.slice(12).join("."));
  }
  if ((bytes[0] & 0xfe) === 0xfc) {
    return true; // fc00::/7 unique local
  }
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) {
    return true; // fe80::/10 link-local
  }
  if (bytes[0] === 0xff) {
    return true; // ff00::/8 multicast
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true; // 2001:db8::/32 documentation
  }
  return false;
}

/** True for addresses the owner server must never fetch from. */
export function isDisallowedRemoteAddress(address: string) {
  const value = String(address ?? "").trim();
  if (!value) {
    return true;
  }
  if (net.isIPv4(value)) {
    return isDisallowedIPv4(value);
  }
  if (net.isIPv6(value)) {
    return isDisallowedIPv6(value);
  }
  return true;
}

export function isPublicRemoteAddress(address: string) {
  const value = String(address ?? "").trim();
  return (net.isIPv4(value) || net.isIPv6(value)) && !isDisallowedRemoteAddress(value);
}

async function defaultResolveHostAddresses(hostname: string) {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

function normalizeHostname(hostname: string) {
  return String(hostname || "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim()
    .toLowerCase();
}

/**
 * Validate an image URL: only http(s), no credentials, and every resolved
 * address must be a public unicast address.
 */
export async function assertRemoteImageUrlAllowed(urlInput: string, options: RemoteImageGuardOptions = {}) {
  let url: URL;
  try {
    url = new URL(String(urlInput ?? ""));
  } catch {
    throw new Error("Invalid remote image url");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported image protocol");
  }
  if (url.username || url.password) {
    throw new Error("Remote image url must not contain credentials");
  }
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new Error("Remote image url is missing a host");
  }
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    const resolver = options.resolveHostAddresses || defaultResolveHostAddresses;
    addresses = await resolver(hostname);
  }
  const uniqueAddresses = [...new Set((addresses || []).map((address) => String(address).trim()).filter(Boolean))];
  if (uniqueAddresses.length === 0) {
    throw new Error("Remote image host could not be resolved");
  }
  if (uniqueAddresses.some((address) => isDisallowedRemoteAddress(address))) {
    throw new Error("Remote image host is not allowed (private or reserved address)");
  }
  return { url, addresses: uniqueAddresses };
}

export type RemoteImageFetchResult = {
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
};

export async function fetchRemoteImage(
  urlInput: string,
  options: RemoteImageGuardOptions = {},
): Promise<RemoteImageFetchResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = Number(options.maxBytes ?? DEFAULT_REMOTE_IMAGE_MAX_BYTES);
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_REMOTE_IMAGE_TIMEOUT_MS);
  const maxRedirects = Math.max(0, Number(options.maxRedirects ?? DEFAULT_REMOTE_IMAGE_MAX_REDIRECTS));
  const redirectStatuses = new Set<number>(REDIRECT_STATUS_CODES);
  const allowedContentTypes = new Set(
    (options.allowedContentTypes || DEFAULT_REMOTE_IMAGE_CONTENT_TYPES).map((type) => type.toLowerCase()),
  );

  // C-F06: follow redirects manually so every hop is SSRF-validated before the
  // next request is issued (redirect:"follow" would connect to a private host
  // first and only validate the final URL afterwards).
  let currentUrl = (await assertRemoteImageUrlAllowed(urlInput, options)).url;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      headers: { Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });

    if (redirectStatuses.has(response.status)) {
      await response.body?.cancel().catch(() => {});
      if (redirectCount >= maxRedirects) {
        throw new Error(`Too many remote image redirects (max ${maxRedirects})`);
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Remote image redirect is missing a Location header");
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new Error("Remote image redirect has an invalid Location");
      }
      // Validate the next hop (protocol/credentials/DNS/private ranges) BEFORE
      // issuing any network request to it.
      await assertRemoteImageUrlAllowed(nextUrl.href, options);
      currentUrl = nextUrl;
      continue;
    }

    // Defensive re-check for custom fetch implementations that still follow
    // redirects internally and expose a different final URL.
    if (response.url) {
      let responseUrl: URL | null = null;
      try {
        responseUrl = new URL(response.url);
      } catch {
        responseUrl = null;
      }
      if (responseUrl && responseUrl.href !== currentUrl.href) {
        await assertRemoteImageUrlAllowed(responseUrl.href, options);
        currentUrl = responseUrl;
      }
    }
    if (!response.ok) {
      throw new Error(`Remote image request failed: ${response.status}`);
    }

    const rawContentType = String(response.headers.get("content-type") || "").toLowerCase();
    const contentType = rawContentType.split(";")[0].trim();
    if (!allowedContentTypes.has(contentType)) {
      throw new Error(`Unsupported remote image content type: ${contentType || "unknown"}`);
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error("Remote image is too large");
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = Buffer.from(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Remote image is too large");
        }
        chunks.push(chunk);
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      totalBytes = buffer.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error("Remote image is too large");
      }
      chunks.push(buffer);
    }

    return { bytes: Buffer.concat(chunks), contentType, finalUrl: currentUrl.href };
  }
}
