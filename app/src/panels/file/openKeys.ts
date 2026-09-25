import type { KeyLike } from "../../lib/keys";
import { ENTER, ESCAPE } from "../keys";

/** The Open screen's own keys: the handler and the hints both read this. */
export const OPEN_KEYS = {
  open: { label: "Enter", matches: (e: KeyLike) => e.key === ENTER && !e.shiftKey },
  asScenario: { label: "Shift+Enter", matches: (e: KeyLike) => e.key === ENTER && e.shiftKey },
  close: { label: "Esc", matches: (e: KeyLike) => e.key === ESCAPE },
};

/** How the hints spell the key that picks the `n`th tab. */
export function tabKeyLabel(n: number): string {
  return `Ctrl+${n}`;
}

/** The tab, counted from 1, that a Ctrl+digit press picks; null for any other press. */
export function tabOfKey(e: KeyLike): number | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const n = Number(e.key);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
