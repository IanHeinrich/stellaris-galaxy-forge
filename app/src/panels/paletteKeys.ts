import type { KeyLike } from "../lib/keys";

/** What a key does in the search palette. */
export type PaletteKey = "pin" | "select" | "go" | "unpin" | "down" | "up" | "kind" | "close";

interface KeyEntry {
  /** How the hints spell the key. */
  label: string;
  matches(e: KeyLike): boolean;
}

const mod = (e: KeyLike) => e.ctrlKey || e.metaKey;

/** The palette's own keys, first match wins: the handler and the hints both read this. */
export const PALETTE_KEYS: Record<PaletteKey, KeyEntry> = {
  pin: { label: "Ctrl+Enter", matches: (e) => e.key === "Enter" && mod(e) },
  select: { label: "Shift+Enter", matches: (e) => e.key === "Enter" && e.shiftKey },
  go: { label: "Enter", matches: (e) => e.key === "Enter" },
  unpin: { label: "Del", matches: (e) => e.key === "Delete" || e.key === "Backspace" },
  down: { label: "↓", matches: (e) => e.key === "ArrowDown" },
  up: { label: "↑", matches: (e) => e.key === "ArrowUp" },
  kind: { label: "Tab", matches: (e) => e.key === "Tab" && !e.shiftKey },
  close: { label: "Esc", matches: (e) => e.key === "Escape" },
};

/** The palette key a press is, or null. */
export function paletteKey(e: KeyLike): PaletteKey | null {
  const keys = Object.keys(PALETTE_KEYS) as PaletteKey[];
  return keys.find((key) => PALETTE_KEYS[key].matches(e)) ?? null;
}

/** `Ctrl+Enter pin`: a hint naming the key for `key` and what it does. */
export function paletteHint(key: PaletteKey, does: string): string {
  return `${PALETTE_KEYS[key].label} ${does}`;
}
