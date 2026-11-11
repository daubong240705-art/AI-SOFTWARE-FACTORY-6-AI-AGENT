/** Use the same canonical text for both indexing and queries, including Vietnamese stroked d. */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/gu, "d").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function buildMatchQuery(userText: string, options: {
  prefixLast?: boolean; maxTerms?: number; maxTermLength?: number;
} = {}): string | null {
  const { prefixLast = true, maxTerms = 12, maxTermLength = 64 } = options;
  if (!Number.isSafeInteger(maxTerms) || maxTerms < 1 || !Number.isSafeInteger(maxTermLength) || maxTermLength < 1) return null;
  const terms = normalizeForSearch(userText).split(" ").filter(Boolean).slice(0, maxTerms)
    .map((term) => Array.from(term).slice(0, maxTermLength).join(""));
  if (!terms.length) return null;
  // Quoting every token makes AND/OR/NOT/NEAR ordinary words, never FTS syntax.
  return terms.map((term, i) => `"${term}"${prefixLast && i === terms.length - 1 ? "*" : ""}`).join(" ");
}

/** Display only the original L0 abstract, never indexed text or body text. */
export function snippetOf(text: string, maxLen = 240): string {
  return Array.from(text).slice(0, Math.max(0, Math.floor(maxLen))).join("");
}
