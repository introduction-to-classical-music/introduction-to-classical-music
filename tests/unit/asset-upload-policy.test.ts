import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ASSET_UPLOAD_BUCKETS,
  resolveAssetUploadDirectory,
  sanitizeAssetUploadRequest,
  sanitizeUploadedFileName,
} from "../../packages/data-core/src/asset-upload-policy.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("asset upload path policy (W3)", () => {
  it("accepts allow-listed buckets, slugs and image extensions", () => {
    const sanitized = sanitizeAssetUploadRequest({
      bucket: "recordings",
      slug: "beethoven-symphony-7",
      fileName: "cover.PNG",
    });
    expect(sanitized).toEqual({
      bucket: "recordings",
      slug: "beethoven-symphony-7",
      fileName: "cover.PNG",
      extension: ".png",
    });
    expect(ASSET_UPLOAD_BUCKETS).toContain("misc");
  });

  it("rejects traversal buckets, invalid slugs and non-image extensions", () => {
    expect(() => sanitizeAssetUploadRequest({ bucket: "../escape", slug: "x", fileName: "a.jpg" })).toThrow(
      /Unsupported asset bucket/,
    );
    expect(() => sanitizeAssetUploadRequest({ bucket: "misc", slug: "../escape", fileName: "a.jpg" })).toThrow(
      /Invalid asset slug/,
    );
    expect(() => sanitizeAssetUploadRequest({ bucket: "misc", slug: "ok", fileName: "evil.exe" })).toThrow(
      /Unsupported asset extension/,
    );
    expect(() => sanitizeUploadedFileName("", "asset")).not.toThrow();
    expect(sanitizeUploadedFileName("", "asset").extension).toBe(".jpg");
  });

  it("resolves the upload directory inside the managed assets root", async () => {
    const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "classical-assets-policy-"));
    tempDirs.push(assetsRoot);

    const directory = resolveAssetUploadDirectory(assetsRoot, { bucket: "composers", slug: "贝多芬" });
    expect(directory.startsWith(path.resolve(assetsRoot))).toBe(true);
    expect(directory).toContain(path.join("composers"));

    expect(() => resolveAssetUploadDirectory(assetsRoot, { bucket: "..", slug: "x" })).toThrow(
      /Unsupported asset bucket/,
    );
  });
});
