/** A pinned search: the text it runs, the colour its rings take, whether they draw. */
export interface WatchEntry {
  query: string;
  colour: number;
  shown: boolean;
}

/** One shown entry's rings: its colour, its place in the list, and the systems it finds. */
export interface WatchRings {
  colour: number;
  slot: number;
  systems: readonly number[];
}

/**
 * The colours entries are handed, clear of `ACCENT_COLOR`, the hover's white, `MATCHED_COLOR`,
 * `SEARCHED_COLOR` and `ALLOWED_COLOR` in `visual/style.ts`.
 */
export const WATCH_COLOURS: readonly number[] = [
  0xfb923c, 0xa3e635, 0xa78bfa, 0x2dd4bf, 0xd6a77a, 0x94a3b8,
];

/** The first colour no entry holds; once every one is taken, the list starts over. */
export function nextColour(inUse: readonly number[]): number {
  const free = WATCH_COLOURS.find((colour) => !inUse.includes(colour));
  return free ?? WATCH_COLOURS[inUse.length % WATCH_COLOURS.length];
}

/** Whether two queries are the same search, whatever their case and surrounding space. */
export function sameQuery(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The entry that pins `query`, if one does. */
export function pinnedEntry(entries: readonly WatchEntry[], query: string): WatchEntry | undefined {
  return entries.find((entry) => sameQuery(entry.query, query));
}

/** What the eye beside an entry does when pressed. */
export function shownLabel(entry: WatchEntry): string {
  return `${entry.shown ? "Hide" : "Show"} "${entry.query}" on the map`;
}

/** What the unpin button beside an entry does. */
export function unpinLabel(query: string): string {
  return `Unpin "${query}"`;
}

/** The rings the map draws: one set per shown entry, placed by the entry's slot in the list. */
export function watchRings(
  entries: readonly WatchEntry[],
  results: ReadonlyMap<string, readonly number[]>,
): WatchRings[] {
  return entries.flatMap((entry, slot) =>
    entry.shown ? [{ colour: entry.colour, slot, systems: results.get(entry.query) ?? [] }] : [],
  );
}
