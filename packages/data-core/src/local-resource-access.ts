import { promises as fs } from "node:fs";
import path from "node:path";

import type { LibraryData, ResourceLink } from "../../shared/src/schema.js";
import { normalizeResourceLink } from "./resource-links.js";

/**
 * Local resource link opening policy (W3 / D3-A).
 *
 * The local site window can no longer open arbitrary paths through an HTTP
 * endpoint. The Electron main process opens a local link over IPC only when the
 * target is either:
 *   1. a `localPath` registered in the active library's resource links, or
 *   2. a file inside the active library directory (its own assets/content).
 * Everything else is rejected before any shell/external program is invoked.
 */
export type LocalResourceAccessOptions = {
  libraryRootDir: string;
  assetsDirs?: string[];
  contentDirs?: string[];
  registeredLocalPaths?: string[];
};

function compact(value: unknown) {
  return String(value ?? "").trim();
}

function collectLinks(links: ResourceLink[] | undefined, target: string[]) {
  for (const link of links || []) {
    const normalized = normalizeResourceLink(link);
    if (normalized.linkType === "local" && normalized.localPath) {
      target.push(normalized.localPath);
    }
  }
}

/** Local paths registered by the library's recordings/info panels. */
export function collectRegisteredLocalResourcePaths(library: Partial<LibraryData>): string[] {
  const paths: string[] = [];
  const infoPanels = [
    ...(library.composers || []).map((entity) => entity.infoPanel),
    ...(library.people || []).map((entity) => entity.infoPanel),
    ...(library.works || []).map((entity) => entity.infoPanel),
    ...(library.workGroups || []).map(() => undefined),
    ...(library.recordings || []).map((entity) => entity.infoPanel),
  ];
  for (const infoPanel of infoPanels) {
    if (infoPanel) {
      collectLinks(infoPanel.collectionLinks || [], paths);
    }
  }
  for (const recording of library.recordings || []) {
    collectLinks(recording.links || [], paths);
  }
  return [...new Set(paths)];
}

export function isPathWithin(parentDir: string, childPath: string): boolean {
  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(childPath);
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isAllowedLocalResourcePath(target: string, options: LocalResourceAccessOptions): boolean {
  const trimmed = compact(target);
  if (!trimmed) {
    return false;
  }
  const resolvedTarget = path.resolve(trimmed);
  const registered = options.registeredLocalPaths || [];
  for (const registeredPath of registered) {
    if (compact(registeredPath) && path.resolve(registeredPath) === resolvedTarget) {
      return true;
    }
  }
  const allowedRoots = [
    options.libraryRootDir,
    ...(options.assetsDirs || []),
    ...(options.contentDirs || []),
  ].filter((root) => compact(root));
  return allowedRoots.some((root) => isPathWithin(root, resolvedTarget));
}

/**
 * Validate a local resource target and return its resolved absolute path.
 * Throws on empty input, out-of-policy paths or missing files.
 */
export async function resolveAllowedLocalResourceTarget(
  target: string,
  options: LocalResourceAccessOptions,
): Promise<string> {
  const trimmed = compact(target);
  if (!trimmed) {
    throw new Error("Missing local resource path");
  }
  if (!isAllowedLocalResourcePath(trimmed, options)) {
    throw new Error("Local resource path is not registered in the active library");
  }
  const resolvedTarget = path.resolve(trimmed);
  await fs.access(resolvedTarget);
  return resolvedTarget;
}
