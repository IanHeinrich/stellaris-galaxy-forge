import { daysLeft, lastsFor, type ModifierRow } from "../../../lib/details/planetPage";
import type { CardItem } from "../HoverCard";

/** What a modifier's card shows: its name, every effect, and how long it lasts. */
export function modifierCard(row: ModifierRow): CardItem {
  return {
    label: row.view?.name ?? row.key,
    effects: row.view?.effects.map((e) => e.text) ?? [],
    note: row.days === null ? undefined : row.stated ? lastsFor(row.days) : daysLeft(row.days),
  };
}
