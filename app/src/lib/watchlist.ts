/** A search kept on the watchlist: the text it runs, the colour its rings take, whether they draw. */
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
 * The colours entries are handed, clear of the selection's yellow, the hover's white, the
 * initializer browser's sky blue, the search palette's pink and the snap target's green.
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

/** The rings the map draws: one set per shown entry, placed by the entry's slot in the list. */
export function watchRings(
  entries: readonly WatchEntry[],
  results: ReadonlyMap<string, readonly number[]>,
): WatchRings[] {
  return entries.flatMap((entry, slot) =>
    entry.shown ? [{ colour: entry.colour, slot, systems: results.get(entry.query) ?? [] }] : [],
  );
}
