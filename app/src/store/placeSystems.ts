import type { RandomSystems } from "../api/addSystem";
import type { LaneEnd } from "../generated/LaneEnd";
import type { NewSystem } from "../generated/NewSystem";
import type { Op } from "../generated/Op";
import type { Pair } from "../lib/geometry/pairs";
import type { Pt } from "../lib/geometry/pt";
import { provisionalIndex } from "../lib/placement/lanes";
import type { Placement } from "../lib/placement/placement";
import { nextSystemId } from "../lib/paint";
import { counted } from "../lib/text";
import { systems } from "./editorEdits";

/** `lead` and what a placement adds: "Painted 3 systems and 2 lanes". */
export function placeDescription(
  lead: string,
  points: readonly Pt[],
  pairs: readonly Pair[],
): string {
  const lanes = pairs.length > 0 ? ` and ${counted(pairs.length, "lane")}` : "";
  return `${lead} ${counted(points.length, "system")}${lanes}`;
}

/**
 * The placement's systems and lanes as one Batch, described by `placeDescription`. It numbers
 * the new systems from the galaxy as it is, so build it inside `runEdit`.
 */
export function placeSystems({ points, pairs }: Placement, lead: string): Op {
  const first = nextSystemId(systems().values());
  const real = (id: number) => (id < 0 ? first + provisionalIndex(id) : id);
  const ops: Op[] = [
    { type: "AddSystems", systems: points.map((p, i) => newSystem(first + i, p)) },
  ];
  if (pairs.length > 0) {
    ops.push({
      type: "AddLanePairs",
      lanes: pairs.map(([a, b]) => ({ a: real(a), b: real(b), bridge: false })),
    });
  }
  return { type: "Batch", description: placeDescription(lead, points, pairs), ops };
}

/** A lane end of a placement: a new point by its index, or a system the galaxy holds. */
function laneEnd(id: number): LaneEnd {
  return id < 0 ? { kind: "new", index: provisionalIndex(id) } : { kind: "held", system: id };
}

/**
 * What rolling a placement's systems into a save sends: each point with the star class rolled
 * for it, and its lanes, a new point's end by its index.
 */
export function rolledArgs(
  { points, pairs, classes }: Placement & { classes: readonly string[] },
  seed: number,
  description: string,
): RandomSystems {
  return {
    seed,
    systems: points.map((p, i) => ({ x: p.x, y: p.y, star_class: classes[i] })),
    lanes: pairs.map(([a, b]) => [laneEnd(a), laneEnd(b)]),
    description,
  };
}

function newSystem(id: number, p: Pt): NewSystem {
  return {
    system: id,
    x: p.x,
    y: p.y,
    name: null,
    initializer: null,
    spawn_weight: null,
    spawn_script: null,
  };
}
