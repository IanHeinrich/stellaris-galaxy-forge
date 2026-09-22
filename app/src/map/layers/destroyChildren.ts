import type { Container } from "pixi.js";

/** Up to this many, children are taken off one by one; past it the list is rebuilt once. */
const ONE_BY_ONE = 16;

/**
 * Takes `doomed` off `parent` and destroys them. Pixi finds each removed child by a search of
 * the whole list, so removing thousands one at a time costs the square of the list.
 */
export function destroyChildren(parent: Container, doomed: ReadonlySet<Container>): void {
  if (doomed.size === 0) return;
  if (doomed.size <= ONE_BY_ONE) {
    for (const child of doomed) child.destroy();
    return;
  }
  const kept = parent.children.filter((child) => !doomed.has(child));
  parent.removeChildren();
  for (const child of kept) parent.addChild(child);
  for (const child of doomed) child.destroy();
}
