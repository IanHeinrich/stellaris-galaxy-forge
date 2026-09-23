import { useEffect, useMemo, useState } from "react";
import type { StarClassView } from "../../generated/StarClassView";
import {
  crisisVariantKeys,
  INTERNAL,
  starClassNameKeys,
  starClassRows,
  visibleStarClassRows,
} from "../../lib/details/starClass";
import { useGameDataStore } from "../../store/gameDataStore";
import type { IconPickerItem } from "../IconPicker";
import { StarRowIcon } from "./StarIcon";

/** The key of the row that reveals the internal classes: never a star class key. */
const REVEAL_INTERNAL_KEY = "__internal_star_classes__";

/** The rows of a star class picker offering `choices`, their names asked for as they are shown. */
export function useStarClassItems(choices: readonly StarClassView[]): IconPickerItem[] {
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const keys = starClassNameKeys(choices).join("|");
  useEffect(() => {
    if (keys !== "") void useGameDataStore.getState().fetchNames(keys.split("|"));
  }, [keys]);

  // Other choices hide the internal classes again.
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const revealInternal = revealedFor === keys;

  const crisisVariants = useMemo(() => crisisVariantKeys(starClasses.values()), [starClasses]);
  const rows = starClassRows(choices, (key) => names.get(key) ?? key, crisisVariants);
  const { rows: shown, internalCount } = visibleStarClassRows(rows, revealInternal);
  const items: IconPickerItem[] = shown.map(({ view, label, group }) => ({
    key: view.key,
    label,
    group,
    icon: <StarRowIcon view={view} />,
  }));
  if (!revealInternal && internalCount > 0) {
    items.push({
      key: REVEAL_INTERNAL_KEY,
      label: `Show ${internalCount} internal ${internalCount === 1 ? "class" : "classes"}`,
      group: INTERNAL,
      onSelect: () => setRevealedFor(keys),
    });
  }
  return items;
}
