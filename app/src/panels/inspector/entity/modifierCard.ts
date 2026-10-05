import { daysLeft, type ModifierRow } from "../../../lib/details/planetPage";
import type { CardItem } from "./PickerCard";

/** What a modifier's card shows: its name, every effect, and how long it lasts. */
export function modifierCard(row: ModifierRow): CardItem {
  return {
    label: row.view?.name ?? row.key,
    effects: row.view?.effects.map((e) => e.text) ?? [],
    note: row.days === null ? undefined : daysLeft(row.days),
  };
}
