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
// C-F13: never hand executable/script-like targets to the OS opener. This is a
// fail-closed policy; the user can still open such files from the file manager.
export const DENIED_LOCAL_RESOURCE_EXTENSIONS = new Set([
  ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".msi", ".scr", ".lnk", ".url",
  ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".reg", ".cpl", ".dll",
  ".jar", ".sh", ".bash", ".zsh", ".py", ".pyw", ".rb", ".pl", ".php", ".app",
]);

export function denyReasonForLocalResourceExtension(target: string): string {
  const extension = path.extname(compact(target)).toLowerCase();
  if (DENIED_LOCAL_RESOURCE_EXTENSIONS.has(extension)) {
    return "出于安全原因，不通过应用打开可执行文件或脚本；请使用系统文件管理器打开该文件";
  }
  return "";
}

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
  const deniedReason = denyReasonForLocalResourceExtension(trimmed);
  if (deniedReason) {
    throw new Error(deniedReason);
  }
  if (!isAllowedLocalResourcePath(trimmed, options)) {
    throw new Error("Local resource path is not registered in the active library");
  }
  const resolvedTarget = path.resolve(trimmed);
  await fs.access(resolvedTarget);
  // realpath both sides so a symlink inside an allowed root cannot escape it.
  let realTarget: string;
  try {
    realTarget = await fs.realpath(resolvedTarget);
  } catch {
    throw new Error("Local resource path could not be resolved");
  }
  const registered = (options.registeredLocalPaths || []).map((value) => compact(value)).filter(Boolean);
  for (const registeredPath of registered) {
    const resolvedRegistered = path.resolve(registeredPath);
    if (resolvedRegistered !== resolvedTarget) continue;
    if (!(await fs.stat(resolvedRegistered)).isFile()) {
      throw new Error("Registered local resource is not a file");
    }
    return resolvedTarget;
  }
  const allowedRoots = [options.libraryRootDir, ...(options.assetsDirs || []), ...(options.contentDirs || [])]
    .map((value) => compact(value))
    .filter(Boolean);
  for (const root of allowedRoots) {
    let realRoot: string;
    try {
      realRoot = await fs.realpath(path.resolve(root));
    } catch {
      continue;
    }
    if (isPathWithin(realRoot, realTarget)) {
      return resolvedTarget;
    }
  }
  throw new Error("Local resource path is not registered in the active library");
}
