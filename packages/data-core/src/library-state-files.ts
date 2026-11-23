import path from "node:path";

/**
 * Internal library state files (F16/R1 rework).
 *
 * `.library-commit.json` and atomic-write `*.tmp` leftovers are bookkeeping for
 * crash recovery, not library content. They must never leak into exports
 * (directory bundle, .icmlibrary package, source export, sync-library-source) or
 * into the official library source tree.
 */
export const LIBRARY_COMMIT_FILE_NAME = ".library-commit.json";

export function normalizeLibraryEntryPath(value: string) {
  return String(value ?? "").replace(/\\/g, "/");
}

/**
 * True for files that are library-internal state rather than content.
 * Accepts either absolute paths or archive/relative paths, with "/" or "\".
 */
export function isLibraryInternalStateEntry(value: string): boolean {
  const normalized = normalizeLibraryEntryPath(value);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  // `runtime/state` holds crash-recovery bookkeeping for bundle libraries.
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "runtime" && segments[index + 1] === "state") {
      return true;
    }
  }

  const basename = segments[segments.length - 1];
  if (basename === LIBRARY_COMMIT_FILE_NAME) {
    return true;
  }
  // writeFileAtomic leftovers: ".<name>.<pid>.<uuid>.tmp"
  if (/^\..+\.tmp$/.test(basename)) {
    return true;
  }
  return false;
}

/** `fs.cp` filter that removes internal state from a copy rooted at sourceRoot. */
export function createLibraryCopyFilter(sourceRoot: string) {
  const resolvedRoot = path.resolve(sourceRoot);
  return (sourcePath: string) => {
    const relativePath = path.relative(resolvedRoot, sourcePath);
    if (!relativePath) {
      return true;
    }
    return !isLibraryInternalStateEntry(relativePath);
  };
}
