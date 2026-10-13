import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { AddSpot } from "../generated/AddSpot";
import type { MegastructureFit } from "../generated/MegastructureFit";
import { leftOutNotice, MEGASTRUCTURES_NEED_GAME_DATA, NOT_PLACED } from "../lib/megastructureCopy";
import type { MegastructureSpot } from "../lib/megastructurePicks";
import { mockedIpc } from "../test/ipc";
import { inSystem } from "../test/session";
import { megastructureSummary, megastructureTypeView, systemDetails } from "../test/builders";
import { openFixtureSave, sessionError } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { editResult } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useMegastructureAddStore } from "./megastructureAdd";
import { useSceneStore } from "./sceneStore";

const SYSTEM = 0;
const adds = () => useMegastructureAddStore.getState();
/** Where the shell stands a relay asked about in space. */
const RELAYED = { place: "free", x: -94.5, y: 126 } as const;

/** What the shell answers for `spot`: every type of the game data, a relay just outside. */
function fitsFor(spot: AddSpot): MegastructureFit[] {
  return [...useGameDataStore.getState().megastructureTypes.keys()].map((kind) => ({
    kind,
    variant: kind,
    place:
      spot.kind === "body"
        ? { place: "body", body: spot.body }
        : kind === "hyper_relay"
          ? RELAYED
          : { place: "free", x: spot.x, y: spot.y },
    refusal: null,
  }));
}

/** Opens the dialog at `spot` and reads its fits, as the dialog does. */
async function opened(spot: MegastructureSpot): Promise<void> {
  adds().open(SYSTEM, spot);
  await adds().loadFits(0);
}

beforeEach(async () => {
  await openFixtureSave();
  inSystem(systemDetails({ id: SYSTEM, inner_radius: 150 }));
  const types = [
    megastructureTypeView("hyper_relay", {
      placement: { place: "free", outside_gravity_well: true },
    }),
    megastructureTypeView("shroud_seal", {
      placement: { place: "free", outside_gravity_well: false },
    }),
    megastructureTypeView("think_tank_3"),
  ];
  useGameDataStore.setState({
    status: "ready",
    megastructureTypes: new Map(types.map((t) => [t.key, t])),
    names: new Map([["think_tank_3", "Science Nexus"]]),
  });
  mockedIpc.addMegastructure.mockResolvedValue({
    edit: editResult({ details_stale: [SYSTEM] }),
    planets: [],
    megastructures: [16],
    unsure: [],
    unwritten: [],
  });
  mockedIpc.getMegastructureFits.mockImplementation(async (_system, spot) => fitsFor(spot));
  useMegastructureAddStore.setState({ last: null });
});

describe("adding a megastructure from the system view", () => {
  it("stands each row where the shell placed it for the spot, and closes the dialog", async () => {
    await opened({ kind: "space", x: -60, y: 80 });
    expect(adds().fits?.get("hyper_relay")?.place).toEqual(RELAYED);
    expect(await adds().add("hyper_relay")).toBe(true);
    expect(adds().prompt).toBeNull();
    await opened({ kind: "space", x: 30, y: 40 });
    await adds().add("shroud_seal");
    await opened({ kind: "body", body: 12, star: false });
    await adds().add("think_tank_3");

    expect(mockedIpc.getMegastructureFits.mock.calls.map(([, spot]) => spot)).toEqual([
      { kind: "space", x: -60, y: 80 },
      { kind: "space", x: 30, y: 40 },
      { kind: "body", body: 12 },
    ]);
    expect(mockedIpc.addMegastructure.mock.calls.map(([, , place]) => place)).toEqual([
      RELAYED,
      { place: "free", x: 30, y: 40 },
      { place: "body", body: 12 },
    ]);
  });

  it("asks what goes at the spot once per generation of its system and load of the game data, and drops an answer for an earlier opening", async () => {
    await opened({ kind: "body", body: 12, star: false });
    await adds().loadFits(0);
    await adds().loadFits(1);
    expect(mockedIpc.getMegastructureFits).toHaveBeenCalledTimes(2);
    useGameDataStore.setState({ version: useGameDataStore.getState().version + 1 });
    await adds().loadFits(1);
    expect(mockedIpc.getMegastructureFits).toHaveBeenCalledTimes(3);

    let answer: (fits: MegastructureFit[]) => void = () => {};
    mockedIpc.getMegastructureFits.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    const late = adds().loadFits(0);
    adds().open(SYSTEM, { kind: "space", x: 30, y: 40 });
    answer(fitsFor({ kind: "body", body: 12 }));
    await late;
    expect(adds().fits).toBeNull();
  });

  it("adds nothing before the fits are read and says so, and asks again after a read that failed", async () => {
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    expect(await adds().add("think_tank_3")).toBe(false);
    expect(mockedIpc.addMegastructure).not.toHaveBeenCalled();
    expect(sessionError()).toBe(NOT_PLACED);

    mockedIpc.getMegastructureFits.mockRejectedValueOnce({ kind: "op", message: "no such system" });
    await opened({ kind: "body", body: 12, star: false });
    expect(adds().fitsError).toBe("no such system");
    await adds().loadFits(0);
    expect(adds().fitsError).toBeNull();
    expect(adds().fits?.has("think_tank_3")).toBe(true);
  });

  it("changes the planet as the game does unless the dialog keeps it, and changes it again on the next opening", async () => {
    const planet = { kind: "body", body: 12, star: false } as const;
    await opened(planet);
    expect(adds().keepPlanet).toBe(false);
    await adds().add("think_tank_3");
    await opened(planet);
    adds().setKeepPlanet(true);
    await adds().add("think_tank_3");
    adds().open(SYSTEM, planet);
    expect(adds().keepPlanet).toBe(false);

    expect(mockedIpc.addMegastructure.mock.calls.map(([, , , keep]) => keep)).toEqual([
      false,
      true,
    ]);
  });

  it("opens the new megastructure's page, named as the game names it", async () => {
    await opened({ kind: "body", body: 12, star: false });
    await adds().add("think_tank_3");

    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1]).toEqual({
      ref: { kind: "megastructure", id: 16 },
      label: "Science Nexus",
    });
    expect(adds().last).toBe("think_tank_3");
    expect(useFileSessionStore.getState().notice).toBeNull();
  });

  it("adds the type the game makes of a stage at the star, and remembers the stage", async () => {
    const variant = { place: { place: "body", body: 12 }, refusal: null } as const;
    mockedIpc.getMegastructureFits.mockResolvedValue([
      { kind: "think_tank_3", variant: "think_tank_3_variant", ...variant },
    ]);
    await opened({ kind: "body", body: 12, star: false });
    await adds().add("think_tank_3_variant", "think_tank_3");

    expect(mockedIpc.addMegastructure.mock.calls[0][1]).toBe("think_tank_3_variant");
    expect(adds().last).toBe("think_tank_3");
  });

  it("says in the status bar how many effects of its construction were left out", async () => {
    mockedIpc.addMegastructure.mockResolvedValue({
      edit: editResult({ details_stale: [SYSTEM] }),
      planets: [],
      megastructures: [16],
      unsure: ["focus.535: change_variable with a value that is not a number", "a.1: event b.2"],
      unwritten: ["removes modifier old_mod from planet 3"],
    });
    await opened({ kind: "body", body: 12, star: false });
    await adds().add("think_tank_3");

    expect(useFileSessionStore.getState().notice).toBe(
      "Added the Science Nexus. Galaxy Forge couldn't tell whether 2 effects of building it apply here, so it left them out. Galaxy Forge can't add 1 effect of building it yet, so it left that out.",
    );
    expect(leftOutNotice("Arc Furnace", 1, 0)).toBe(
      "Added the Arc Furnace. Galaxy Forge couldn't tell whether 1 effect of building it applies here, so it left that out.",
    );
    expect(leftOutNotice("Arc Furnace", 0, 3)).toBe(
      "Added the Arc Furnace. Galaxy Forge can't add 3 effects of building it yet, so it left them out.",
    );
    expect(leftOutNotice("Arc Furnace", 0, 0)).toBeNull();
  });

  it("opens no page when the core refuses the add", async () => {
    mockedIpc.addMegastructure.mockRejectedValue({ kind: "op", message: "a refusal" });
    await opened({ kind: "body", body: 12, star: false });

    expect(await adds().add("think_tank_3")).toBe(false);
    expect(adds().last).toBeNull();
    const { stack } = useInspectorStore.getState();
    expect(stack.some((entry) => entry.ref.kind === "megastructure")).toBe(false);
  });

  it("is refused without game data, with the reason", () => {
    useGameDataStore.setState({ status: "idle" });

    expect(adds().open(SYSTEM, { kind: "space", x: 30, y: 40 })).toBe(false);
    expect(adds().prompt).toBeNull();
    expect(sessionError()).toBe(MEGASTRUCTURES_NEED_GAME_DATA);
  });
});

describe("adding a habitat from the system view", () => {
  beforeEach(() => {
    const complex = megastructureTypeView("habitat_central_complex", { habitat: true });
    useGameDataStore.setState({
      megastructureTypes: new Map([[complex.key, complex]]),
    });
    mockedIpc.addHabitat.mockResolvedValue({
      edit: editResult({ details_stale: [SYSTEM] }),
      planets: [16777273],
      megastructures: [],
    });
  });

  it("adds the finished Habitat Central Complex as a habitat round the body, and selects it", async () => {
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    expect(await adds().add("habitat_central_complex")).toBe(true);

    expect(mockedIpc.addHabitat.mock.calls).toEqual([[SYSTEM, 12, "habitat_central_complex"]]);
    expect(mockedIpc.addMegastructure).not.toHaveBeenCalled();
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SYSTEM, ids: [16777273] });
    expect(adds().last).toBe("habitat_central_complex");
  });

  it("selects nothing when the core refuses the habitat", async () => {
    mockedIpc.addHabitat.mockRejectedValue({ kind: "op", message: "a refusal" });
    adds().open(SYSTEM, { kind: "body", body: 3, star: false });

    expect(await adds().add("habitat_central_complex")).toBe(false);
    expect(adds().last).toBeNull();
    expect(useSceneStore.getState().bodySelection).toBeNull();
  });
});

describe("adding on a body that has a megastructure", () => {
  it("adds the habitat there", async () => {
    const complex = megastructureTypeView("habitat_central_complex", { habitat: true });
    const nexus = megastructureTypeView("think_tank_3");
    const types = new Map([complex, nexus].map((t) => [t.key, t]));
    useGameDataStore.setState({ megastructureTypes: types });
    mockedIpc.addHabitat.mockResolvedValue({
      edit: editResult({ details_stale: [SYSTEM] }),
      planets: [16777273],
      megastructures: [],
    });
    inSystem(
      systemDetails({
        id: SYSTEM,
        megastructures: [megastructureSummary({ kind: "orbital_ring_ruined", planet: 12 })],
      }),
    );

    await opened({ kind: "body", body: 12, star: false });
    expect(await adds().add("habitat_central_complex")).toBe(true);
    expect(mockedIpc.addHabitat.mock.calls).toEqual([[SYSTEM, 12, "habitat_central_complex"]]);
  });
});

describe("adding a whole ring world from the system view", () => {
  const star = { kind: "body", body: 1, star: true } as const;
  const clearing = {
    system: SYSTEM,
    bodies: [5, 4],
    moons: 1,
    colonies: [],
    belts: 0,
    starbase_bodies: [],
    megastructures: [],
  };

  beforeEach(() => {
    mockedIpc.addRingWorld.mockResolvedValue({
      edit: editResult({ details_stale: [SYSTEM] }),
      planets: [16777300, 16777301],
      megastructures: [40],
    });
    mockedIpc.getRingWorldClearing.mockResolvedValue(clearing);
  });

  it("sends the picked stages and the clear flag in one add, and closes the dialog", async () => {
    adds().open(SYSTEM, star);
    adds().setRingStages("ruined");
    adds().setRingStage(0, "finished");
    adds().setRingStage(3, "damaged");
    adds().setRingClear(true);

    expect(await adds().addRing("ring_world_2_intermediate")).toBe(true);
    expect(mockedIpc.addRingWorld.mock.calls).toEqual([
      [SYSTEM, "ring_world_2_intermediate", ["finished", "ruined", "ruined", "damaged"], true],
    ]);
    expect(mockedIpc.addMegastructure).not.toHaveBeenCalled();
    expect(adds().prompt).toBeNull();
    expect(adds().last).toBe("ring_world_2_intermediate");
  });

  it("sends the picked size's ring, puts back to finished a quadrant the size offers no stage for, and opens next on the Ring tile", async () => {
    adds().open(SYSTEM, star);
    adds().setRingStages("damaged");
    adds().setRingStage(1, "frame");
    adds().setRingSize("ringworld_titanic_1", ["finished", "frame", "ruined"]);
    expect(adds().ringSize).toBe("ringworld_titanic_1");
    expect(adds().ringStages).toEqual(["finished", "frame", "finished", "finished"]);

    expect(await adds().addRing("ringworld_titanic_1", "ring_world_2_intermediate")).toBe(true);
    expect(mockedIpc.addRingWorld.mock.calls).toEqual([
      [SYSTEM, "ringworld_titanic_1", ["finished", "frame", "finished", "finished"], false],
    ]);
    expect(adds().last).toBe("ring_world_2_intermediate");
  });

  it("opens with every quadrant finished, the first size and the planets left, and leaves them when not told", async () => {
    adds().open(SYSTEM, star);
    adds().setRingStages("frame");
    adds().setRingSize("ringworld_titanic_1", ["finished", "frame", "ruined"]);
    adds().setRingClear(true);
    adds().cancel();
    adds().open(SYSTEM, star);

    expect(adds().ringStages).toEqual(["finished", "finished", "finished", "finished"]);
    expect(adds().ringSize).toBeNull();
    expect(adds().ringClear).toBe(false);
    await adds().addRing("ring_world_2_intermediate");
    expect(mockedIpc.addRingWorld.mock.calls[0].slice(2)).toEqual([
      ["finished", "finished", "finished", "finished"],
      false,
    ]);
  });

  it("reads what clearing takes once per opening, and says why when it can't", async () => {
    adds().open(SYSTEM, star);
    await adds().loadClearing();
    await adds().loadClearing();
    expect(mockedIpc.getRingWorldClearing.mock.calls).toEqual([[SYSTEM]]);
    expect(adds().clearing).toEqual(clearing);

    mockedIpc.getRingWorldClearing.mockRejectedValue({ kind: "op", message: "no such system" });
    adds().open(SYSTEM, star);
    expect(adds().clearing).toBeNull();
    await adds().loadClearing();
    expect(adds().clearingError).toBe("no such system");
  });

  it("remembers nothing when the core refuses the ring", async () => {
    mockedIpc.addRingWorld.mockRejectedValue({ kind: "op", message: "a refusal" });
    adds().open(SYSTEM, star);

    expect(await adds().addRing("ring_world_2_intermediate")).toBe(false);
    expect(adds().last).toBeNull();
  });
});
