/** What the map and the legend call a system the game gives a random initializer to. */
export const RANDOM_INITIALIZER_LABEL = "random";

/** Above this many distinct keys the legend offers a search box. */
export const INITIALIZER_SEARCH_MIN = 6;

/** What the legend calls the keys the loaded game data does not account for. */
export const OTHER_GROUP = { id: "other", label: "Other" };

/** One initializer key and how many systems carry it. */
export interface InitializerCount {
  key: string;
  count: number;
}

/** One heading in the legend and the keys the document uses under it. */
export interface InitializerLegendGroup {
  id: string;
  label: string;
  rows: InitializerCount[];
}

/** A group of initializers as the game data defines them, whether or not this document uses any. */
export interface InitializerSource {
  id: string;
  label: string;
  entries: ReadonlyArray<{ name: string }>;
}

/** An initializer key as it is drawn and listed. */
export function initializerLabel(key: string): string {
  return key === "" ? RANDOM_INITIALIZER_LABEL : key;
}

/** The distinct initializer keys over `systems`, most used first, ties broken by label. */
export function initializerCounts(systems: Iterable<{ initializer: string }>): InitializerCount[] {
  const counts = new Map<string, number>();
  for (const s of systems) counts.set(s.initializer, (counts.get(s.initializer) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort(
      (a, b) => b.count - a.count || initializerLabel(a.key).localeCompare(initializerLabel(b.key)),
    );
}

/**
 * The counted keys under the game data's own groups, each group in the order it defines them,
 * the keys it does not account for last under "Other". The random key belongs to no group: the
 * legend lists it on its own, first.
 */
export function legendGroups(
  counts: readonly InitializerCount[],
  groups: readonly InitializerSource[],
): InitializerLegendGroup[] {
  const byKey = new Map(counts.filter((c) => c.key !== "").map((c) => [c.key, c]));
  const out: InitializerLegendGroup[] = [];
  for (const group of groups) {
    const rows: InitializerCount[] = [];
    for (const entry of group.entries) {
      const row = byKey.get(entry.name);
      if (row) {
        rows.push(row);
        byKey.delete(entry.name);
      }
    }
    if (rows.length > 0) out.push({ id: group.id, label: group.label, rows });
  }
  if (byKey.size > 0) out.push({ ...OTHER_GROUP, rows: [...byKey.values()] });
  return out;
}

/** Whether a system's star and name are dimmed because its initializer is filtered out. */
export function dimmedByInitializer(
  node: { initializer: string },
  hidden: ReadonlySet<string>,
): boolean {
  return hidden.has(node.initializer);
}
