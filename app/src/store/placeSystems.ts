import type { NewSystem } from "../generated/NewSystem";
import type { Op } from "../generated/Op";
import type { Pt } from "../lib/geometry/pt";
import { provisionalIndex } from "../lib/placement/lanes";
import type { Placement } from "../lib/placement/placement";
import { nextSystemId } from "../lib/paint";
import { counted } from "../lib/text";
import { systems } from "./editorEdits";

/**
 * The placement's systems and lanes as one Batch, described as `lead` and the counts ("Painted
 * 3 systems and 2 lanes"). It numbers the new systems from the galaxy as it is, so build it
 * inside `runEdit`.
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
  const lanes = pairs.length > 0 ? ` and ${counted(pairs.length, "lane")}` : "";
  return { type: "Batch", description: `${lead} ${counted(points.length, "system")}${lanes}`, ops };
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
