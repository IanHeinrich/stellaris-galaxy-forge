import { useRef, type KeyboardEvent } from "react";
import { isEditableTarget } from "../../lib/keys";
import { listStep } from "../gridKeys";
import { ENTER } from "../keys";

/** How far PgUp and PgDn move. */
const PAGE = 10;

export interface BrowserKeys<K extends string> {
  /** The rows the list shows, in order. */
  keys: readonly K[];
  highlighted: K | null;
  onHighlight(key: K): void;
  /** Enter picks the highlighted row, and Shift+Enter picks it and keeps the browser open. */
  onChoose(keepOpen: boolean): void;
  /** Ctrl+D on the highlighted row. */
  onPin(key: K): void;
}

/**
 * The keyboard of a browser dialog: the arrows, Home, End, PgUp and PgDn move the highlight, Enter
 * picks and Ctrl+D pins. The search field keeps Home and End, and any other field all its keys.
 */
export function useBrowserKeys<K extends string>({
  keys,
  highlighted,
  onHighlight,
  onChoose,
  onPin,
}: BrowserKeys<K>) {
  const search = useRef<HTMLInputElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    const fromSearch = e.target === search.current;
    if (!fromSearch && isEditableTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() !== "d") return;
      e.preventDefault();
      if (highlighted !== null) onPin(highlighted);
      return;
    }
    if (e.key === ENTER) {
      e.preventDefault();
      onChoose(e.shiftKey);
      return;
    }
    if (fromSearch && (e.key === "Home" || e.key === "End")) return;
    const at = highlighted === null ? -1 : keys.indexOf(highlighted);
    const to = listStep(e.key, at, keys.length, { page: PAGE });
    if (to === null) return;
    e.preventDefault();
    onHighlight(keys[to]);
  };

  return { search, onKeyDown };
}
