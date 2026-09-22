/** `["gas", "giant"]` → `Gas Giant`; empty words are dropped and `special` overrides a word. */
export function titleCase(words: readonly string[], special: Record<string, string> = {}): string {
  return words
    .filter((w) => w !== "")
    .map((w) => special[w] ?? w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** `3, "system"` → `3 systems`; `1, "lane"` → `1 lane`. */
export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
