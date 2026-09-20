import type { SearchKind } from "../../generated/SearchKind";

/** What each kind prefix (`e:`) restricts the palette to. */
export const KIND_PREFIXES: ReadonlyArray<[prefix: string, kind: SearchKind]> = [
  ["s", "system"],
  ["e", "country"],
  ["p", "planet"],
  ["f", "fleet"],
  ["n", "nebula"],
];

/** The group heading each kind of hit sits under, in the order the core returns them. */
export const GROUP_LABELS: Record<SearchKind, string> = {
  system: "Systems",
  country: "Empires",
  planet: "Planets",
  fleet: "Fleets",
  nebula: "Nebulae",
};

export const KIND_ORDER: readonly SearchKind[] = ["system", "country", "planet", "fleet", "nebula"];

export interface Query {
  /** Only hits of this kind, or null for every kind. */
  kind: SearchKind | null;
  /** What is left to match on, without the prefix. */
  text: string;
}

/** `e:vex` searches empires for "vex"; anything else searches everything. */
export function parseQuery(raw: string): Query {
  const text = raw.trimStart();
  for (const [prefix, kind] of KIND_PREFIXES) {
    if (text.toLowerCase().startsWith(`${prefix}:`)) {
      return { kind, text: text.slice(prefix.length + 1).trim() };
    }
  }
  return { kind: null, text: text.trim() };
}

/** What the prefix a query carries is called in the field's own hint. */
export function prefixLabel(q: Query): string {
  return q.kind === null ? "Everything" : GROUP_LABELS[q.kind];
}

const CYCLE: readonly string[] = ["", ...KIND_PREFIXES.map(([p]) => `${p}:`)];

/** Tab: the same words under the next prefix, everything → systems → … → nebulae → everything. */
export function nextPrefix(raw: string): string {
  const q = parseQuery(raw);
  const current = q.kind === null ? "" : kindPrefix(q.kind);
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
  return `${next}${q.text}`;
}

function kindPrefix(kind: SearchKind): string {
  return `${KIND_PREFIXES.find(([, k]) => k === kind)?.[0] ?? ""}:`;
}
