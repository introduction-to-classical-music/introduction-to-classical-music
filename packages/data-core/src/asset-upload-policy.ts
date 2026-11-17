import path from "node:path";

import { isPathWithin } from "./local-resource-access.js";

/**
 * Upload path policy for `/api/assets/upload` (W3 / A3).
 *
 * The bucket used to be accepted verbatim, so `../` could escape the managed
 * assets directory. Buckets and file extensions are now allow-listed and the
 * final directory is resolved and containment-checked before writing.
 */
export const ASSET_UPLOAD_BUCKETS = [
  "composers",
  "people",
  "recordings",
  "works",
  "articles",
  "conductors",
  "orchestras",
  "ensembles",
  "misc",
] as const;

export const ASSET_UPLOAD_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"] as const;

export type SanitizedAssetUpload = {
  bucket: (typeof ASSET_UPLOAD_BUCKETS)[number];
  slug: string;
  fileName: string;
  extension: (typeof ASSET_UPLOAD_EXTENSIONS)[number];
};

export function sanitizeAssetBucket(rawBucket: unknown): SanitizedAssetUpload["bucket"] {
  const bucket = String(rawBucket ?? "").trim().toLowerCase();
  if (!(ASSET_UPLOAD_BUCKETS as readonly string[]).includes(bucket)) {
    throw new Error(`Unsupported asset bucket: ${bucket || "(empty)"}`);
  }
  return bucket as SanitizedAssetUpload["bucket"];
}

export function sanitizeAssetSlug(rawSlug: unknown): string {
  const slug = String(rawSlug ?? "").trim();
  if (!slug) {
    throw new Error("Missing asset slug");
  }
  if (!/^[\p{L}\p{N}_-]{1,120}$/u.test(slug)) {
    throw new Error("Invalid asset slug");
  }
  return slug;
}

export function sanitizeUploadedFileName(rawFileName: unknown, fallbackSlug = "asset"): {
  fileName: string;
  extension: SanitizedAssetUpload["extension"];
} {
  const fileName = String(rawFileName ?? "").trim() || `${fallbackSlug}.jpg`;
  const extension = path.extname(fileName).toLowerCase();
  if (!(ASSET_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error(`Unsupported asset extension: ${extension || "(none)"}`);
  }
  return { fileName, extension: extension as SanitizedAssetUpload["extension"] };
}

export function sanitizeAssetUploadRequest(input: {
  bucket: unknown;
  slug: unknown;
  fileName: unknown;
}): SanitizedAssetUpload {
  const bucket = sanitizeAssetBucket(input.bucket);
  const slug = sanitizeAssetSlug(input.slug);
  const { fileName, extension } = sanitizeUploadedFileName(input.fileName, slug);
  return { bucket, slug, fileName, extension };
}

/** Resolve `<assetsManagedDir>/<bucket>/<sanitized-slug>` and enforce containment. */
export function resolveAssetUploadDirectory(
  assetsManagedDir: string,
  input: { bucket: unknown; slug: unknown },
): string {
  const bucket = sanitizeAssetBucket(input.bucket);
  const slug = sanitizeAssetSlug(input.slug);
  const sanitizedSegment = slug
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "") || "asset";
  const resolvedDir = path.resolve(assetsManagedDir, bucket, sanitizedSegment);
  if (!isPathWithin(assetsManagedDir, resolvedDir)) {
    throw new Error("Asset upload path escapes the managed assets directory");
  }
  return resolvedDir;
}
