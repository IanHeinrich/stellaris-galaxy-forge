/** The ancestors of `el` that scroll from top to bottom, nearest first. */
export function scrollParents(el: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") found.push(at);
  }
  return found;
}
