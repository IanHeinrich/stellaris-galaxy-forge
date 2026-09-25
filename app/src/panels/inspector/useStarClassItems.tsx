import { useMemo, useState } from "react";
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
import { useNamed } from "../useNamed";
import { StarRowIcon } from "./StarIcon";
import { counted } from "../../lib/text";

/** The key of the row that reveals the internal classes: never a star class key. */
const REVEAL_INTERNAL_KEY = "__internal_star_classes__";

/** The rows of a star class picker offering `choices`, their names asked for as they are shown. */
export function useStarClassItems(choices: readonly StarClassView[]): IconPickerItem[] {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const nameKeys = starClassNameKeys(choices);
  const named = useNamed(nameKeys);
  const keys = nameKeys.join("|");

  // Other choices hide the internal classes again.
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const revealInternal = revealedFor === keys;

  const crisisVariants = useMemo(() => crisisVariantKeys(starClasses.values()), [starClasses]);
  const rows = starClassRows(choices, named, crisisVariants);
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
      label: `Show ${counted(internalCount, "internal class", "internal classes")}`,
      group: INTERNAL,
      onSelect: () => setRevealedFor(keys),
    });
  }
  return items;
}
