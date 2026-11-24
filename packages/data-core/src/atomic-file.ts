import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Crash-safe file writes (F16).
 *
 * JSON state files used to be written with a plain `fs.writeFile`, so a crash
 * (or power loss) during the write could leave a truncated/invalid file. Writes
 * now go to a temporary file in the same directory, are flushed with fsync, and
 * are then renamed over the destination (rename is atomic on the same volume).
 */
export type AtomicWriteOptions = {
  /** Flush the temporary file before rename. Defaults to true. */
  fsync?: boolean;
};

async function fsyncFileHandle(handle: Awaited<ReturnType<typeof fs.open>>) {
  // `FileHandle.sync()` (fsync) is available on all supported Node versions.
  await handle.sync();
}

async function fsyncParentDirectory(directory: string) {
  if (process.platform === "win32") {
    return;
  }
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is a durability nicety, not required for correctness.
  }
}

export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
) {
  const resolvedPath = path.resolve(filePath);
  const directory = path.dirname(resolvedPath);
  await fs.mkdir(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporaryPath, "w");
  try {
    await handle.writeFile(content);
    if (options.fsync !== false) {
      await fsyncFileHandle(handle);
    }
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(temporaryPath, resolvedPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  await fsyncParentDirectory(directory);
}

export async function writeJsonFileAtomic(filePath: string, value: unknown) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
