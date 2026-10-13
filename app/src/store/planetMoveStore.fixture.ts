import type { Op } from "../generated/Op";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import { flush } from "../test/flush";
import { mockedIpc } from "../test/ipc";
import { openFixtureSave } from "./editorFixture";
import { editResult } from "./fixture";
import { usePlanetMoveStore } from "./planetMoveStore";
import { useSceneStore } from "./sceneStore";

export const SOL = 0;
export const CENTAURI = 1;
export const BARNARD = 2;
export const EARTH = 10;
export const MARS = 11;
export const LUNA = 12;
export const JUPITER = 13;

export const COLONY: PlanetMoveWarning = { planet: MARS, kind: "colony", owner: 0, new_owner: 1 };

export const moves = () => usePlanetMoveStore.getState();

export function targets(
  planets: number[],
  over: Partial<PlanetMoveTargets> = {},
): PlanetMoveTargets {
  return {
    planets,
    refused: [],
    systems: [
      { system: CENTAURI, warnings: [] },
      { system: BARNARD, warnings: [COLONY] },
    ],
    ...over,
  };
}

export const MOVE: Op = {
  type: "Batch",
  description: "Moved 2 planets to Alpha Centauri",
  ops: [
    { type: "MoveBodyToSystem", body: EARTH, to: CENTAURI },
    { type: "MoveBodyToSystem", body: MARS, to: CENTAURI },
  ],
};

/** Earth and Mars of Sol selected, with the targets for them in. */
export async function selectTwo(): Promise<void> {
  useSceneStore.getState().selectBody(SOL, EARTH);
  useSceneStore.getState().toggleBody(SOL, MARS);
  await flush();
}

/** The sample save open, and the shell answering every target and move. */
export async function armMoves(): Promise<void> {
  await openFixtureSave();
  mockedIpc.planetMoveTargets.mockImplementation(async (planets) => targets(planets));
  mockedIpc.planetMoveOp.mockResolvedValue(MOVE);
  mockedIpc.applyOp.mockResolvedValue(editResult());
}
