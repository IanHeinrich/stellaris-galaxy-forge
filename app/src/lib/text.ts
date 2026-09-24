/** `["gas", "giant"]` → `Gas Giant`; empty words are dropped and `special` overrides a word. */
export function titleCase(words: readonly string[], special: Record<string, string> = {}): string {
  return words
    .filter((w) => w !== "")
    .map((w) => special[w] ?? w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** `1600` → `1,600`: a count or a cost as the game writes it. */
export function thousands(n: number): string {
  return n.toLocaleString("en-US");
}

/** `3, "system"` → `3 systems`; `1, "lane"` → `1 lane`. */
export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
