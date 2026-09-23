import { useEffect } from "react";
import type { StarClassView } from "../../generated/StarClassView";
import { starClassNameKeys, starClassRows } from "../../lib/details/starClass";
import { useGameDataStore } from "../../store/gameDataStore";
import type { IconPickerItem } from "../IconPicker";
import { StarRowIcon } from "./StarIcon";

/** The rows of a star class picker offering `choices`, their names asked for as they are shown. */
export function useStarClassItems(choices: readonly StarClassView[]): IconPickerItem[] {
  const names = useGameDataStore((s) => s.names);
  const keys = starClassNameKeys(choices).join("|");
  useEffect(() => {
    if (keys !== "") void useGameDataStore.getState().fetchNames(keys.split("|"));
  }, [keys]);
  return starClassRows(choices, (key) => names.get(key) ?? key).map(
    ({ view, label, group, note }) => ({
      key: view.key,
      label,
      group,
      note,
      icon: <StarRowIcon view={view} />,
    }),
  );
}
