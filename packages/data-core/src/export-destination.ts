import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Export destination guard for `/api/library/export-site` (W3 / A3).
 *
 * The route used to recursively `rm` any caller-supplied path. Destinations are
 * now rejected when they are a drive root, a system directory, the user home
 * directory, or inside the active library; a non-empty existing directory
 * requires an explicit `overwrite` confirmation.
 */
export type ExportDestinationOptions = {
  overwrite?: boolean;
  activeLibraryRoot?: string;
  homeDir?: string;
  systemRoots?: string[];
};

export type ExportDestinationError = Error & { code: string };

function failure(code: string, message: string): ExportDestinationError {
  return Object.assign(new Error(message), { code });
}

function isPathWithin(parentDir: string, childPath: string) {
  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(childPath);
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function getSystemExportRoots(): string[] {
  const candidates = [
    process.env.SystemRoot,
    process.env.windir,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.ProgramData,
    process.platform === "win32" ? "C:\\Windows" : "",
  ];
  return [...new Set(candidates.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function assertExportDestinationAllowed(
  destinationPath: string,
  options: ExportDestinationOptions = {},
): string {
  const trimmed = String(destinationPath ?? "").trim();
  if (!trimmed) {
    throw failure("destination-required", "Missing site export destination path");
  }
  const resolved = path.resolve(trimmed);

  // Drive roots (C:\, D:/) and UNC share roots (\\server\share) are never valid.
  if (/^[A-Za-z]:[\\/]?$/.test(resolved) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(resolved)) {
    throw failure("destination-root", "Refusing to export to a drive or share root");
  }

  const homeDir = options.homeDir || os.homedir();
  if (homeDir && path.resolve(homeDir) === resolved) {
    throw failure("destination-home", "Refusing to export directly into the user home directory");
  }

  for (const root of options.systemRoots && options.systemRoots.length ? options.systemRoots : getSystemExportRoots()) {
    if (root && isPathWithin(root, resolved)) {
      throw failure("destination-system", `Refusing to export into a system directory: ${root}`);
    }
  }

  if (options.activeLibraryRoot && isPathWithin(options.activeLibraryRoot, resolved)) {
    throw failure("destination-library", "Refusing to export inside the active library directory");
  }

  return resolved;
}

/**
 * Validate the destination and its current state. A non-empty existing
 * directory requires `overwrite: true`; a path that exists as a file is always
 * rejected.
 */
export async function assertExportDestinationSafe(
  destinationPath: string,
  options: ExportDestinationOptions = {},
): Promise<string> {
  const resolved = assertExportDestinationAllowed(destinationPath, options);
  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch {
    return resolved; // new directory: safe
  }
  if (!stats.isDirectory()) {
    throw failure("destination-not-directory", "Export destination exists and is not a directory");
  }
  if (options.overwrite) {
    return resolved;
  }
  const entries = await fs.readdir(resolved);
  if (entries.length > 0) {
    throw failure(
      "destination-not-empty",
      "Export destination is not empty; confirm overwrite to replace its contents",
    );
  }
  return resolved;
}
