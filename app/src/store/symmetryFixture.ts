import type { NewSystem } from "../generated/NewSystem";
import type { SpawnScript } from "../generated/SpawnScript";
import type { Symmetry } from "../lib/geometry/symmetry";
import { joinBoth, openFixtureScenario } from "./editorFixture";
import { editResult, node } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { useToolStore } from "./toolStore";
import { mockedIpc } from "../test/ipc";

export const MIRROR_X: Symmetry = { kind: "mirror", axis: "x" };
export const QUARTER: Symmetry = { kind: "rotate", n: 4 };

/**
 * Beside the fixture, whose Sol sits at the centre and Alpha Centauri and Sirius on the x axis:
 * 10 and 11 mirror each other across it, 12 sits on it, and nothing mirrors 13. 20 to 23 are
 * one system's four quarter turns.
 */
export const PLACED = [
  node(10, "NAME_Upper", 100, 50, "sc_g", [], { initializer: "" }),
  node(11, "NAME_Lower", 100, -50, "sc_g", [], { initializer: "" }),
  node(12, "NAME_Axis", 200, 0, "sc_g", [], { initializer: "" }),
  node(13, "NAME_Lone", 150, 80, "sc_g", [], { initializer: "" }),
  node(20, "NAME_East", 300, 100, "sc_g", [], { initializer: "" }),
  node(21, "NAME_North", -100, 300, "sc_g", [], { initializer: "" }),
  node(22, "NAME_West", -300, -100, "sc_g", [], { initializer: "" }),
  node(23, "NAME_South", 100, -300, "sc_g", [], { initializer: "" }),
];
export const FIRST_FREE = 24;

export const link = (...pairs: Array<[number, number]>) => joinBoth("lanes", ...pairs);
export const bar = (...pairs: Array<[number, number]>) => joinBoth("prevented", ...pairs);

export function sym(symmetry: Symmetry): void {
  useToolStore.setState({ symmetry });
}

export const sent = () => mockedIpc.applyOp.mock.calls[mockedIpc.applyOp.mock.calls.length - 1][0];

export function seat(kind: "enabled" | "preferred" | "sol", random_value: number, player = false) {
  return { paint_a_galaxy: { kind, random_value, player } };
}

/** Seats on 20, 21 and 23 of one quarter-turn orbit, and none on 22. */
export function placeSeats(): void {
  const all = useGalaxyStore.getState().systems;
  const seated = (id: number, script: SpawnScript) => ({ ...all.get(id)!, spawn_script: script });
  useGalaxyStore.getState().applyDelta({
    systems: [
      seated(20, seat("preferred", 3)),
      seated(21, seat("sol", 7)),
      seated(23, seat("enabled", 5)),
    ],
  });
}

export function added(id: number, x: number, y: number, extra: Partial<NewSystem> = {}): NewSystem {
  return {
    system: id,
    x,
    y,
    name: null,
    initializer: null,
    spawn_weight: null,
    spawn_script: null,
    ...extra,
  };
}

/** The fixture scenario open with `PLACED` beside it, every op applied, and symmetry off. */
export async function openPlaced(): Promise<void> {
  await openFixtureScenario();
  mockedIpc.applyOp.mockResolvedValue(editResult());
  useGalaxyStore.getState().applyDelta({ systems: PLACED });
  useToolStore.setState({ symmetry: { kind: "off" } });
}
