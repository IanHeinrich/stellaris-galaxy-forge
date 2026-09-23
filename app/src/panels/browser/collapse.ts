import { useCallback, useState } from "react";
import { browserCollapseKey } from "../../store/prefKeys";
import { isStringArray, readPref, writePref } from "../../store/prefs";

export interface Collapse {
  /** Whether the group is collapsed, given the state it starts a fresh profile in. */
  collapsed(key: string, byDefault?: boolean): boolean;
  toggle(key: string): void;
}

/** Which of a list's groups the user has turned away from their default, across launches. */
export function useCollapse(list: string): Collapse {
  const key = browserCollapseKey(list);
  const [flipped, setFlipped] = useState<Set<string>>(
    () => new Set(readPref<string[]>(key, [], isStringArray)),
  );
  const toggle = useCallback(
    (group: string) => {
      setFlipped((previous) => {
        const next = new Set(previous);
        if (!next.delete(group)) next.add(group);
        writePref(key, [...next]);
        return next;
      });
    },
    [key],
  );
  return {
    collapsed: (group, byDefault = false) => (flipped.has(group) ? !byDefault : byDefault),
    toggle,
  };
}
