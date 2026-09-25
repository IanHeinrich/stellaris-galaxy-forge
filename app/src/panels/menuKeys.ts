import type { KeyboardEvent } from "react";

/** The items of a menu a key can move to: every enabled `menuitem` under `root`, in order. */
export function menuItems(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
}

/** Moves focus through the items under `root` on the arrow keys, Home and End, wrapping round. */
export function menuKeyDown(root: HTMLElement | null, e: KeyboardEvent): void {
  const items = menuItems(root);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (index: number) => {
    e.preventDefault();
    items[(index + items.length) % items.length].focus();
  };
  if (e.key === "ArrowDown") go(at + 1);
  else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
}
