import { ALL_CAPABILITIES } from "../../lib/capabilities";
import type { Capabilities } from "../../generated/Capabilities";
import type { EditResult } from "../../generated/EditResult";
import type { HistoryEntry } from "../../generated/HistoryEntry";
import type { OpenResult } from "../../generated/OpenResult";
import type { SaveResult } from "../../generated/SaveResult";
import type { SystemNode } from "../../generated/SystemNode";
import { name, saveMeta, systemNode } from "../../test/builders";

export type LaneSpec = [to: number, length: number, bridge?: boolean, stale?: boolean];

/** A system of the galaxy below: planets and an initializer, unlike a bare `systemNode`. */
export function node(
  id: number,
  key: string,
  x: number,
  y: number,
  star_class: string,
  lanes: LaneSpec[] = [],
  extra: Partial<SystemNode> = {},
): SystemNode {
  return systemNode({
    id,
    name: name(key),
    x,
    y,
    star_class,
    lanes: lanes.map(([to, length, bridge = false, stale = false]) => ({
      to,
      length,
      bridge,
      stale,
    })),
    planet_count: 5,
    initializer: "basic_init_01",
    ...extra,
  });
}

/** Six systems: a chain 0-1-2-3 with a hub at 1, a bridge 1-4, and an isolated 5 in a nebula. */
export const SYSTEMS: SystemNode[] = [
  node(0, "NAME_Sol", 0, 0, "sc_g", [[1, 10]]),
  node(1, "NAME_Alpha_Centauri", 10, 0, "sc_binary_1", [
    [0, 10],
    [2, 14],
    [3, 20],
    [4, 30, true],
  ]),
  node(2, "NAME_Barnard", 20, 10, "sc_m", [[1, 14]]),
  node(3, "NAME_Sirius", 30, 0, "sc_a", [[1, 20]]),
  node(4, "NAME_Vega", 10, -30, "sc_black_hole", [[1, 30, true]], { bypass_ids: [7] }),
  node(5, "NAME_Deneb", -40, 40, "sc_k", [], { nebula: 0, planet_count: 0 }),
];

/** Both ends of lane `a`–`b` re-projected with `length`, as a delta would carry them. */
export function withLaneLength(a: number, b: number, length: number, stale = true): SystemNode[] {
  return SYSTEMS.filter((s) => s.id === a || s.id === b).map((s) => ({
    ...s,
    lanes: s.lanes.map((l) => (l.to === a || l.to === b ? { ...l, length, stale } : l)),
  }));
}

/** The sample save, opened. Its path is known, so a test may pass it straight to an action. */
export const OPEN_RESULT: OpenResult & { path: string } = {
  path: "C:/saves/test/2206.11.16.sav",
  cloud: false,
  kind: "save",
  painted: false,
  title: "Test Empire",
  meta: saveMeta(),
  galaxy: {
    systems: SYSTEMS,
    nebulae: [{ name: name("NAME_Cloud"), x: -40, y: 40, radius: 20, systems: [5] }],
    waystations: [],
    waylines: [],
    bypasses: [{ type: "gateway", system: 4, active: true }],
    countries: [],
    galaxy_radius: 60,
    core_radius: 15,
    header: [],
    components: 2,
  },
  issues: [
    { severity: "warning", code: "system_isolated", message: "Deneb has no lanes", systems: [5] },
  ],
  capabilities: ALL_CAPABILITIES,
};

/** What a static galaxy scenario supports: scripted empires, no lengths, systems can be added. */
export const SCENARIO_CAPABILITIES: Capabilities = {
  empires: true,
  details: false,
  lane_lengths: false,
  nebulae: true,
  bypasses: false,
  special: true,
  create_systems: true,
  lane_bridges: false,
  waylines: false,
};

/** The same galaxy as `OPEN_RESULT`, opened from a scenario file: a title and no save header. */
export const SCENARIO_RESULT: OpenResult & { path: string } = {
  ...OPEN_RESULT,
  path: "C:/mods/map/setup_scenarios/my_galaxy.txt",
  kind: "scenario",
  title: "my_galaxy",
  meta: null,
  capabilities: SCENARIO_CAPABILITIES,
};

function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    seq: 1,
    description: "Move Sol",
    ...overrides,
  };
}

/** A minimal `EditResult` built from `SYSTEMS`: an untouched delta and one undo entry. */
export function editResult(overrides: Partial<EditResult> = {}): EditResult {
  const entry = historyEntry();
  return {
    entry,
    delta: { systems: [] },
    issues: OPEN_RESULT.issues,
    history: { undo: [entry], redo: [] },
    dirty: true,
    details_stale: [],
    touched_entities: [],
    reclassifies: false,
    ...overrides,
  };
}

/** A minimal `SaveResult` for the session's current path, with no backup. */
export function saveResult(overrides: Partial<SaveResult> = {}): SaveResult {
  return {
    path: OPEN_RESULT.path,
    cloud: false,
    backup_path: null,
    dirty: false,
    ...overrides,
  };
}
