/**
 * Where a key moves the active row of a list of `count` rows from `at`: Up and Down a row, Home
 * and End to either end, and with `page` PageUp and PageDown that many rows. With `wrap` Up and
 * Down run on round the ends; without, every move stops at them. Null for a key the list does not
 * move on, or for a list with no rows.
 */
export function listStep(
  key: string,
  at: number,
  count: number,
  { page, wrap = false }: { page?: number; wrap?: boolean } = {},
): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const clamp = (to: number) => Math.min(last, Math.max(0, to));
  switch (key) {
    case "ArrowDown":
      return wrap ? (at + 1) % count : clamp(at + 1);
    case "ArrowUp":
      return wrap ? (at - 1 + count) % count : clamp(at - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return page === undefined ? null : clamp(at + page);
    case "PageUp":
      return page === undefined ? null : clamp(at - page);
    default:
      return null;
  }
}

/** How many tiles a row of `grid` holds, as its layout resolved them. */
export function columnsOf(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
}

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

/**
 * Where a key moves the active item of `groups`, each laid out `columns` to a row and starting
 * a row of its own: Left and Right run on through every group, Up and Down move a row within
 * the group, and past its first or last row to the same column of the group before or after.
 * The key of the item it lands on, or null for a key the groups do not move on.
 */
export function groupedGridStep(
  groups: readonly { items: readonly { key: string }[] }[],
  key: string,
  pressed: string,
  columns: number,
): string | null {
  const flat = groups.flatMap((group) => group.items);
  if (flat.length === 0) return null;
  const at = Math.max(
    0,
    flat.findIndex((item) => item.key === key),
  );
  const horizontal = gridStep(at, pressed, flat.length, columns);
  if (pressed !== "ArrowUp" && pressed !== "ArrowDown") {
    return typeof horizontal === "number" ? flat[horizontal].key : null;
  }
  const { group, index } = gridPlace(groups, flat[at].key);
  const items = groups[group].items;
  const width = Math.max(1, columns);
  const within = gridStep(index, pressed, items.length, width);
  const lastRow = Math.floor((items.length - 1) / width);
  const leaves = pressed === "ArrowUp" ? within === "above" : Math.floor(index / width) === lastRow;
  if (!leaves) return typeof within === "number" ? items[within].key : null;
  const next = group + (pressed === "ArrowUp" ? -1 : 1);
  if (next < 0 || next >= groups.length) return pressed === "ArrowUp" ? null : items[index].key;
  const target = groups[next].items;
  const column = index % width;
  const row = pressed === "ArrowUp" ? Math.floor((target.length - 1) / width) : 0;
  return target[Math.min(target.length - 1, row * width + column)].key;
}
