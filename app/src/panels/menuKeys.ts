import type { KeyboardEvent } from "react";
import { listStep } from "./gridKeys";

/** The items of a menu a key can move to: every enabled `menuitem` under `root`, in order. */
export function menuItems(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
}

/** Moves focus through the items under `root` on the arrow keys, Home and End, wrapping round. */
export function menuKeyDown(root: HTMLElement | null, e: KeyboardEvent): void {
  const items = menuItems(root);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  // With nothing focused, Up starts from the first item so it wraps to the last.
  const to = listStep(e.key, at < 0 && e.key === "ArrowUp" ? 0 : at, items.length, { wrap: true });
  if (to === null) return;
  e.preventDefault();
  items[to].focus();
}
