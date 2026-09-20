/** `["gas", "giant"]` → `Gas Giant`; empty words are dropped and `special` overrides a word. */
export function titleCase(words: readonly string[], special: Record<string, string> = {}): string {
  return words
    .filter((w) => w !== "")
    .map((w) => special[w] ?? w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
