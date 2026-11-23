/**
 * HTML-safe name emphasis for the directory browser (F06).
 *
 * The directory page renders `fullName` / `nameLatin` / `originalName` with
 * `set:html` so a match can be wrapped in `<strong>`. Library data is user
 * editable, so the value and the highlight must both be HTML-escaped before any
 * markup is inserted; otherwise a composer name containing `<script>` would be
 * executed in the local site and in public exports.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;

export function escapeHtmlText(value: string): string {
  return String(value ?? "").replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPE_MAP[character] ?? character);
}

/**
 * Escape `value` first, then wrap every occurrence of the (also escaped)
 * `highlight` in `<strong>`. The returned string is safe to pass to `set:html`.
 */
export function emphasizeHtml(value: string, highlight: string): string {
  const text = String(value ?? "");
  const escapedValue = escapeHtmlText(text);
  const marker = String(highlight ?? "");
  if (!text || !marker || !text.includes(marker)) {
    return escapedValue;
  }
  const escapedMarker = escapeHtmlText(marker);
  if (!escapedMarker || !escapedValue.includes(escapedMarker)) {
    return escapedValue;
  }
  return escapedValue.split(escapedMarker).join(`<strong>${escapedMarker}</strong>`);
}
