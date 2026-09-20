import type { ReferenceVia } from "../../../../../generated/ReferenceVia";
import type { ScriptRow } from "../../../../../generated/ScriptRow";
import type { ScriptRowKind } from "../../../../../generated/ScriptRowKind";

/** The order the section groups its rows in: what runs first, then what the chain reaches. */
export const KIND_ORDER: readonly ScriptRowKind[] = [
  "initializer",
  "spawned_initializer",
  "scripted_effect",
  "scenario_effect",
  "event",
  "on_action",
];

/** How many rows of one kind the section lists before it offers the rest. */
export const KIND_CAP = 8;

/** The key a script writes to reach a system, without the flag or target it named. */
const VIA_KEY: Record<ReferenceVia, string> = {
  star_flag: "has_star_flag",
  global_flag: "has_global_flag",
  planet_flag: "has_planet_flag",
  event_target: "event_target",
  initializer: "initializer",
  call: "call",
};

/** What tells one row from another across renders: the triple the backend built the row on. */
export function rowKey(row: ScriptRow): string {
  const { location } = row.sites[0];
  return `${row.kind}:${row.name}:${location.file ?? location.display}`;
}

/** What a collapsed row says about its sites: the ways they name the system, and whose file won. */
export function summaryLine(row: ScriptRow): string {
  const vias = [...new Set(row.vias)].map((via) => VIA_KEY[via]);
  const { layer } = row.sites[0].location;
  return vias.length === 0 ? layer : `${vias.join(", ")} · ${layer}`;
}

/** One kind's rows, and how many of them the cap holds back. */
export interface ScriptGroup {
  kind: ScriptRowKind;
  rows: ScriptRow[];
  hidden: number;
}

export interface GroupedRows {
  /** The system's own initializer and the scenario effect: first, and never capped. */
  pinned: ScriptRow[];
  groups: ScriptGroup[];
  /** How many rows the filter kept, pinned rows included. */
  matched: number;
}

/** The filter matches what the reader can see: the name, its localised title and the files. */
function matches(row: ScriptRow, needle: string): boolean {
  if (row.name.toLowerCase().includes(needle)) return true;
  if (row.title !== null && row.title.toLowerCase().includes(needle)) return true;
  return row.sites.some((site) => site.location.display.toLowerCase().includes(needle));
}

/** The pinned rows, then one capped group per kind; a filter lifts every cap while it is typed in. */
export function groupRows(
  rows: readonly ScriptRow[],
  query: string,
  uncapped: ReadonlySet<ScriptRowKind>,
): GroupedRows {
  const needle = query.trim().toLowerCase();
  const kept = needle === "" ? [...rows] : rows.filter((row) => matches(row, needle));
  const lifted = needle !== "";
  const groups: ScriptGroup[] = [];
  for (const kind of KIND_ORDER) {
    const all = kept.filter((row) => row.kind === kind && !row.pinned);
    if (all.length === 0) continue;
    const shown = lifted || uncapped.has(kind) ? all.length : Math.min(all.length, KIND_CAP);
    groups.push({ kind, rows: all.slice(0, shown), hidden: all.length - shown });
  }
  return { pinned: kept.filter((row) => row.pinned), groups, matched: kept.length };
}
