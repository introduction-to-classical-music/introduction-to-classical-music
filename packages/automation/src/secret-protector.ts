import { execFileSync } from "node:child_process";

/**
 * DPAPI-backed secret protector (C-F07 / release S2).
 *
 * The desktop app stores LLM settings under `%APPDATA%` (appData.secretsPath).
 * The file must never contain the API key in plaintext: we encrypt the JSON
 * payload with Windows DPAPI (CurrentUser scope) via a tiny PowerShell helper,
 * and store only a versioned ciphertext envelope.
 *
 * Tests inject a fake protector with `setSecretProtectorForTests`; production
 * code never falls back to plaintext when DPAPI is unavailable.
 */
export type SecretProtector = {
  protect(plaintext: string): Promise<string>;
  unprotect(ciphertext: string): Promise<string>;
};

export type SecretEnvelope = {
  schemaVersion: "dpapi-v1";
  scope: "CurrentUser";
  ciphertext: string;
};

const DPAPI_SCHEMA_VERSION = "dpapi-v1";
let injectedProtector: SecretProtector | null = null;
let defaultProtector: SecretProtector | null = null;

export function setSecretProtectorForTests(protector: SecretProtector | null) {
  injectedProtector = protector;
}

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === DPAPI_SCHEMA_VERSION &&
    typeof record.ciphertext === "string" &&
    String(record.ciphertext).length > 0
  );
}

export function createDpapiSecretEnvelope(ciphertext: string): SecretEnvelope {
  return { schemaVersion: DPAPI_SCHEMA_VERSION, scope: "CurrentUser", ciphertext };
}

const DPAPI_PROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($raw)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const DPAPI_UNPROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($raw)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;

async function runPowerShellDpapi(script: string, base64Input: string): Promise<string> {
  const stdout = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { input: base64Input, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  const output = String(stdout || "").trim();
  if (!output) {
    throw new Error("DPAPI helper returned no output");
  }
  return output;
}

export function createWindowsDpapiProtector(): SecretProtector {
  if (process.platform !== "win32") {
    throw new Error("Windows DPAPI is unavailable on this platform; refusing plaintext secret fallback");
  }
  return {
    async protect(plaintext) {
      const protectedBase64 = await runPowerShellDpapi(
        DPAPI_PROTECT_SCRIPT,
        Buffer.from(String(plaintext), "utf8").toString("base64"),
      );
      return protectedBase64;
    },
    async unprotect(ciphertext) {
      const plainBase64 = await runPowerShellDpapi(DPAPI_UNPROTECT_SCRIPT, String(ciphertext));
      return Buffer.from(plainBase64, "base64").toString("utf8");
    },
  };
}

function resolveProtector(): SecretProtector {
  if (injectedProtector) {
    return injectedProtector;
  }
  if (!defaultProtector) {
    try {
      defaultProtector = createWindowsDpapiProtector();
    } catch (error) {
      throw new Error(
        `LLM secrets require Windows DPAPI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return defaultProtector;
}

export async function protectSecret(plaintext: string): Promise<SecretEnvelope> {
  const protector = resolveProtector();
  const ciphertext = await protector.protect(plaintext);
  if (!ciphertext) {
    throw new Error("DPAPI protector returned an empty ciphertext");
  }
  return createDpapiSecretEnvelope(ciphertext);
}

export async function unprotectSecret(envelope: SecretEnvelope): Promise<string> {
  const protector = resolveProtector();
  try {
    return await protector.unprotect(envelope.ciphertext);
  } catch (error) {
    throw new Error(
      `Failed to decrypt LLM secrets with Windows DPAPI (refusing plaintext fallback): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
