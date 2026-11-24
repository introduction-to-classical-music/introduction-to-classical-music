/**
 * Log/error redaction (release S8).
 *
 * Prevent secrets and machine-specific paths from reaching local logs or
 * user-visible error strings. Keep this conservative: mask values, do not drop
 * whole diagnostic lines.
 */

const SECRET_KEY_PATTERN =
  /(\b(?:api[_-]?key|apikey|authorization|access[_-]?token|refresh[_-]?token|token|secret|password|bootstrap|session(?:id|token)?)\b["']?\s*[:=]\s*["']?)([^\s"'&,;]{4,})/gi;
const BEARER_PATTERN = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>|]+/g;
const POSIX_HOME_PATH_PATTERN = /(?:\/Users\/|\/home\/)[^\s"'<>|]+/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const QQ_PATTERN = /\b(?:QQ|qq)\s*[:：]?\s*\d{5,12}\b/g;

export function redactSensitiveText(input: unknown): string {
  let text = typeof input === "string" ? input : String(input ?? "");
  text = text.replace(BEARER_PATTERN, "$1[redacted]");
  text = text.replace(SECRET_KEY_PATTERN, (_match, prefix: string) => `${prefix}[redacted]`);
  text = text.replace(WINDOWS_PATH_PATTERN, "<local-path>");
  text = text.replace(POSIX_HOME_PATH_PATTERN, "<local-path>");
  text = text.replace(EMAIL_PATTERN, "<email>");
  text = text.replace(QQ_PATTERN, "QQ: [redacted]");
  return text;
}

export function redactError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.message);
  }
  return redactSensitiveText(error);
}
