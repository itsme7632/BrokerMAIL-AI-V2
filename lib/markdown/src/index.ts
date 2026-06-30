/**
 * Shared lightweight Markdown-style inline formatting.
 *
 * This is the single source of truth for how `**bold**`, `*italic*`,
 * `~~strikethrough~~`, `__underline__` and `` `code` `` are recognized across
 * the app — used by:
 *  - SingleEmailComposer's live contentEditable formatter (DOM-based, applies
 *    these rules as the user types via `MD_RULES`)
 *  - TemplateEditor's Plain/HTML previews and the backend's final email HTML
 *    builder (string-based, via `markdownToHtml`)
 *
 * Precedence is bold > strikethrough > underline > italic > code so that
 * `**bold**` is never mistaken for two `*italic*` markers.
 */

export interface MarkdownRule {
  /** Matches text ending at the cursor (anchored with `$`) — used for live, incremental DOM formatting. */
  re: RegExp;
  tag: string;
  style?: string;
}

const CODE_STYLE =
  "font-family:monospace;background:#f1f5f9;border-radius:3px;padding:1px 5px;font-size:0.875em;color:#e11d48;";

/**
 * Cursor-anchored rules (text-before-cursor must END with the full pattern).
 * Consumed by SingleEmailComposer's `applyMarkdownInline` while typing.
 */
export const MD_RULES: ReadonlyArray<MarkdownRule> = [
  { re: /\*\*([^*\n]{1,300})\*\*$/, tag: "strong" },
  { re: /~~([^~\n]{1,300})~~$/, tag: "s" },
  { re: /__([^_\n]{1,300})__$/, tag: "u" },
  // Italic: negative lookbehind ensures we don't match the tail of **bold**
  { re: /(?<!\*)\*([^*\n]{1,300})\*$/, tag: "em" },
  { re: /`([^`\n]{1,300})`$/, tag: "code", style: CODE_STYLE },
];

/** Same patterns as `MD_RULES`, but global (non cursor-anchored) — for converting a whole string at once. */
const GLOBAL_RULES: ReadonlyArray<{ re: RegExp; tag: string; style?: string }> = [
  { re: /\*\*([^*\n]+?)\*\*/g, tag: "strong" },
  { re: /~~([^~\n]+?)~~/g, tag: "s" },
  { re: /__([^_\n]+?)__/g, tag: "u" },
  { re: /\*([^*\n]+?)\*/g, tag: "em" },
  { re: /`([^`\n]+?)`/g, tag: "code", style: CODE_STYLE },
];

// Backslash-escape handling: \**text** / \*text* / \~~text~~ / \__text__ / \`text` keep their
// literal characters instead of being converted. We swap them for Unicode Private-Use-Area
// placeholders before running the conversions, then restore the literal characters afterward.
const ESCAPES: ReadonlyArray<{ re: RegExp; literal: string; placeholder: string }> = [
  { re: /\\\*\*/g, literal: "**", placeholder: "\uE000" },
  { re: /\\~~/g, literal: "~~", placeholder: "\uE001" },
  { re: /\\__/g, literal: "__", placeholder: "\uE002" },
  { re: /\\\*/g, literal: "*", placeholder: "\uE003" },
  { re: /\\`/g, literal: "`", placeholder: "\uE004" },
];

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converts a plain-text string containing Markdown-style inline formatting into HTML.
 * Does NOT touch `{variable}` placeholders — they pass through untouched since they
 * don't match any of the formatting patterns above.
 *
 * Input is assumed to be plain text (not yet HTML-escaped) — this function escapes
 * HTML special characters itself before applying formatting, so it's safe to call
 * directly on raw template/body text.
 */
export function markdownToHtml(raw: string): string {
  let text = escapeHtml(raw ?? "");

  for (const { re, placeholder } of ESCAPES) {
    text = text.replace(re, placeholder);
  }

  for (const rule of GLOBAL_RULES) {
    const styleAttr = rule.style ? ` style="${rule.style}"` : "";
    text = text.replace(rule.re, (_m, inner) => `<${rule.tag}${styleAttr}>${inner}</${rule.tag}>`);
  }

  for (const { literal, placeholder } of ESCAPES) {
    text = text.replaceAll(placeholder, literal);
  }

  return text;
}
