/**
 * Where a key moves the active tile of a grid of `count` tiles laid out `columns` to a row: the
 * new index, `"above"` for Up on the first row, or null for a key the grid does not move on.
 * Left and Right run on across rows; Down onto a short last row lands on its last tile.
 */
export function gridStep(
  at: number,
  key: string,
  count: number,
  columns: number,
): number | "above" | null {
  const last = count - 1;
  const width = Math.max(1, columns);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, at - 1);
    case "ArrowRight":
      return Math.min(last, at + 1);
    case "ArrowUp":
      return at - width < 0 ? "above" : at - width;
    case "ArrowDown": {
      if (at + width <= last) return at + width;
      const onLastRow = Math.floor(at / width) === Math.floor(last / width);
      return onLastRow ? at : last;
    }
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/** The group and index of the item keyed `key`; the first group's first item when none is. */
export function gridPlace(
  groups: readonly { items: readonly { key: string }[] }[],
  key: string,
): { group: number; index: number } {
  for (const [group, { items }] of groups.entries()) {
    const index = items.findIndex((item) => item.key === key);
    if (index >= 0) return { group, index };
  }
  return { group: 0, index: 0 };
}
