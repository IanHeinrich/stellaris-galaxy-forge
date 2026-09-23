import { useEffect } from "react";
import { detailsSave, type OpenLists, type Row } from "../../lib/openRows";
import { useOpenScreenStore } from "../../store/openScreenStore";

/** How long the selection rests on a save before its galaxy settings are read. */
const DETAILS_DELAY_MS = 150;

/** Reads the galaxy settings of the save the selection rests on, once it has rested a moment. */
export function useDetailsFor(row: Row | undefined, lists: OpenLists): void {
  const save = detailsSave(row, lists);
  const path = save?.meta ? save.path : null;
  const modified = save?.modified ?? 0;
  useEffect(() => {
    if (path === null) return;
    const timer = setTimeout(() => {
      void useOpenScreenStore.getState().loadDetails(path, modified);
    }, DETAILS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [path, modified]);
}
