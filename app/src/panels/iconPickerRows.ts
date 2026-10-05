import type { IconPickerItem } from "./IconPicker";
import { FILTER_MIN } from "./parts";

/** One row of an icon picker's list, and whether its group's header starts above it. */
export interface IconPickerRow {
  item: IconPickerItem;
  header: boolean;
}

/** Whether a picker of `items` shows a filter box above its list. */
export function hasFilter(items: readonly IconPickerItem[]): boolean {
  return items.length > FILTER_MIN;
}

/**
 * The rows a picker of `items` lists for `query`: the items whose label or key holds it, ignoring
 * case, so a group shows its header only while it has a match.
 */
export function iconPickerRows(items: readonly IconPickerItem[], query: string): IconPickerRow[] {
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? items
      : items.filter(
          (item) =>
            item.label.toLowerCase().includes(needle) || item.key.toLowerCase().includes(needle),
        );
  return shown.map((item, i) => ({
    item,
    header: item.group !== undefined && item.group !== shown[i - 1]?.group,
  }));
}

/** The row `active` stands on once the list has `count` rows: the last row if it fell off the end, -1 with none. */
export function activeRow(active: number, count: number): number {
  return Math.min(active, count - 1);
}
