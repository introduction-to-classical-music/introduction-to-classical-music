import { spawn } from "node:child_process";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Protocol policy for shell-openable external targets (W3 / A3).
 * Only web links and mailto: are allowed; `file:`, `javascript:`, `smb:` and
 * other schemes are rejected before `shell.openExternal` sees them.
 */
export function isAllowedExternalTarget(target: string): boolean {
  const trimmed = String(target ?? "").trim();
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return false;
    }
    if (url.protocol === "mailto:") {
      return Boolean(url.pathname.trim());
    }
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

function getOpenCommand() {
  if (process.platform === "win32") {
    return { command: "explorer.exe", args: (target: string) => [target] };
  }
  if (process.platform === "darwin") {
    return { command: "open", args: (target: string) => [target] };
  }
  return { command: "xdg-open", args: (target: string) => [target] };
}

export async function openTargetInShell(target: string) {
  const normalizedTarget = String(target ?? "").trim();
  if (!normalizedTarget) {
    throw new Error("Open target cannot be empty");
  }

  const opener = getOpenCommand();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(opener.command, opener.args(normalizedTarget), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
