import { useMemo } from "react";
import { classListOf, type ClassList } from "../../../lib/details/classList";
import { useGameDataStore } from "../../../store/gameDataStore";
import type { BodyRead } from "./bodySources";

/** The list of what body `read`'s class can be, as its Class row shows it; null where it has none. */
export function useClassList(read: BodyRead): ClassList | null {
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(
    () => classListOf(read.details, read.summary, names, starClasses),
    [read, names, starClasses],
  );
}
