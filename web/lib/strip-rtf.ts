/**
 * Minimal RTF -> plain-text converter, ported from `redline.py::_strip_rtf`.
 *
 * Designed for the simple RTF that TextEdit / Word produce when saving an
 * NDA -- not a full RTF parser. Handles the patterns we actually see:
 *   - \'XX hex-encoded code-page bytes (smart quotes, em dashes, etc.)
 *   - \uNNNN unicode escapes (with the optional \uc fallback char)
 *   - \par / \line as line breaks
 *   - control words and {} groups stripped
 * Then normalizes smart punctuation to ASCII so snippet matching is robust.
 */
export function stripRtf(text: string): string {
  let out = text;

  // 1. Drop RTF header groups whose contents are pure metadata (font/color
  //    tables, stylesheets, info blocks). They appear once near the top and
  //    contribute zero document text. We match {...} groups whose first
  //    control word is one of these declarations. Run twice to catch nested
  //    sibling groups in the same pass.
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(
      /\{\\\*?\\?(?:fonttbl|colortbl|expandedcolortbl|stylesheet|listtable|listoverridetable|rsidtbl|info|generator|themedata|colorschememapping|latentstyles)\b[^{}]*\}/g,
      "",
    );
  }

  // 2. \'XX hex byte -> CP1252 character (handles smart quotes, em dashes).
  out = out.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    const byte = parseInt(hex, 16);
    return cp1252Char(byte);
  });

  // 3. \uNNNN unicode escape (Word emits these for non-CP1252 chars).
  out = out.replace(/\\u(-?\d+)\\?'?[0-9a-fA-F]{0,2}\s?/g, (_, n) => {
    const code = ((parseInt(n, 10) % 0x10000) + 0x10000) % 0x10000;
    return String.fromCharCode(code);
  });

  out = out.replace(/\\uc\d+\s?/g, "");

  // 4. Paragraph / line breaks.
  out = out.replace(/\\par[d]?\b/g, "\n");
  out = out.replace(/\\line\b/g, "\n");

  // 5. Strip remaining RTF control words like \fs24, \cf0, \pardirnatural.
  out = out.replace(/\\[a-zA-Z]+-?\d* ?/g, "");

  // 6. Strip group braces (after table-group removal so they don't get reused).
  out = out.replace(/[{}]/g, "");

  // 7. Unescape literal backslash and apostrophe escapes.
  out = out.replace(/\\\\/g, "\\").replace(/\\'/g, "'");

  // 8. RTF often ends each visible line with a stray "\" continuation. After
  //    earlier passes we'll see these as a literal "\" before the newline.
  out = out.replace(/\\\s*\n/g, "\n");
  out = out.replace(/\\+$/gm, "");

  // 9. Collapse runs of blank lines to at most one, and trim each line's
  //    trailing whitespace to keep the rendered document tidy.
  out = out.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");

  return normalizeSmartPunctuation(out).trim();
}

export function isRtf(text: string): boolean {
  return text.trimStart().startsWith("{\\rtf");
}

function normalizeSmartPunctuation(s: string): string {
  return s
    .replace(/[‘’]/g, "'") // ' '
    .replace(/[“”]/g, '"') // " "
    .replace(/[–—‑]/g, "-"); // – — ‑
}

const CP1252_OVERRIDES: Record<number, string> = {
  // Windows-1252 differs from Latin-1 in the 0x80-0x9F block. Map the most
  // common typography characters that show up in NDAs.
  0x80: "€", // €
  0x82: "‚", // ‚
  0x83: "ƒ", // ƒ
  0x84: "„", // „
  0x85: "…", // …
  0x86: "†", // †
  0x87: "‡", // ‡
  0x88: "ˆ", // ˆ
  0x89: "‰", // ‰
  0x8A: "Š", // Š
  0x8B: "‹", // ‹
  0x8C: "Œ", // Œ
  0x8E: "Ž", // Ž
  0x91: "‘", // '
  0x92: "’", // '
  0x93: "“", // "
  0x94: "”", // "
  0x95: "•", // •
  0x96: "–", // –
  0x97: "—", // —
  0x98: "˜", // ˜
  0x99: "™", // ™
  0x9A: "š", // š
  0x9B: "›", // ›
  0x9C: "œ", // œ
  0x9E: "ž", // ž
  0x9F: "Ÿ", // Ÿ
};

function cp1252Char(byte: number): string {
  return CP1252_OVERRIDES[byte] ?? String.fromCharCode(byte);
}
