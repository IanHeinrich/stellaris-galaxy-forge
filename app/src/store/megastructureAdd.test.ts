import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import {
  BODY_HAS_MEGASTRUCTURE,
  HABITAT_ROUND_SATELLITE,
  leftOutNotice,
  MEGASTRUCTURES_NEED_GAME_DATA,
  megastructureRefusal,
  RELAY_RADIUS_FACTOR,
} from "../lib/megastructurePicks";
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
    megastructure: 16,
    unsure: [],
    unwritten: [],
  });
  useMegastructureAddStore.setState({ last: null });
});

describe("adding a megastructure from the system view", () => {
  it("stands a relay just outside the inner radius at the angle pressed, and closes the dialog", async () => {
    expect(adds().open(SYSTEM, { kind: "space", x: -60, y: 80 })).toBe(true);
    expect(await adds().add("hyper_relay")).toBe(true);

    expect(adds().prompt).toBeNull();
    const [system, kind, place] = mockedIpc.addMegastructure.mock.calls[0];
    expect([system, kind]).toEqual([SYSTEM, "hyper_relay"]);
    if (place.place !== "free") throw new Error(`placed on body ${place.body}`);
    const radius = RELAY_RADIUS_FACTOR * 150;
    expect(place.x).toBeCloseTo((radius * -60) / 100);
    expect(place.y).toBeCloseTo((radius * 80) / 100);
  });

  it("stands a type built inside the gravity well where pressed, and ties a body's to the body", async () => {
    adds().open(SYSTEM, { kind: "space", x: 30, y: 40 });
    await adds().add("shroud_seal");
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    await adds().add("think_tank_3");

    expect(mockedIpc.addMegastructure.mock.calls.map(([, , place]) => place)).toEqual([
      { place: "free", x: 30, y: 40 },
      { place: "body", body: 12 },
    ]);
  });

  it("opens the new megastructure's page, named as the game names it", async () => {
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
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
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    await adds().add("think_tank_3_variant", "think_tank_3");

    expect(mockedIpc.addMegastructure.mock.calls[0][1]).toBe("think_tank_3_variant");
    expect(adds().last).toBe("think_tank_3");
  });

  it("says in the status bar how many effects of its construction were left out", async () => {
    mockedIpc.addMegastructure.mockResolvedValue({
      edit: editResult({ details_stale: [SYSTEM] }),
      megastructure: 16,
      unsure: ["focus.535: change_variable with a value that is not a number", "a.1: event b.2"],
      unwritten: ["removes modifier old_mod from planet 3"],
    });
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    await adds().add("think_tank_3");

    expect(useFileSessionStore.getState().notice).toBe(
      "Added the Science Nexus. Galaxy Forge couldn't tell whether 2 of its construction's effects apply, so it left them out. Galaxy Forge doesn't write 1 of its construction's effects yet, so it left it out.",
    );
    expect(leftOutNotice("Arc Furnace", 1, 0)).toBe(
      "Added the Arc Furnace. Galaxy Forge couldn't tell whether 1 of its construction's effects applies, so it left it out.",
    );
    expect(leftOutNotice("Arc Furnace", 0, 3)).toBe(
      "Added the Arc Furnace. Galaxy Forge doesn't write 3 of its construction's effects yet, so it left them out.",
    );
    expect(leftOutNotice("Arc Furnace", 0, 0)).toBeNull();
  });

  it("opens no page when the core refuses the add", async () => {
    mockedIpc.addMegastructure.mockRejectedValue({ kind: "op", message: "a refusal" });
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });

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
      planet: 16777273,
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

  it("is refused round a body that orbits a planet, and nowhere else", () => {
    const complex = useGameDataStore.getState().megastructureTypes.get("habitat_central_complex")!;
    const spot = { kind: "body", body: 3, star: false } as const;
    const types = useGameDataStore.getState().megastructureTypes;
    expect(megastructureRefusal(complex, { ...spot, orbitsPlanet: true }, [], types)).toBe(
      HABITAT_ROUND_SATELLITE,
    );
    expect(megastructureRefusal(complex, spot, [], types)).toBeNull();
  });
});

describe("adding on a body that has a megastructure", () => {
  it("greys out the row types and keeps the habitat, which it adds", async () => {
    const complex = megastructureTypeView("habitat_central_complex", { habitat: true });
    const nexus = megastructureTypeView("think_tank_3");
    const types = new Map([complex, nexus].map((t) => [t.key, t]));
    useGameDataStore.setState({ megastructureTypes: types });
    mockedIpc.addHabitat.mockResolvedValue({
      edit: editResult({ details_stale: [SYSTEM] }),
      planet: 16777273,
    });
    const rows = [megastructureSummary({ kind: "orbital_ring_ruined", planet: 12 })];
    const spot = { kind: "body", body: 12, star: false } as const;

    expect(adds().open(SYSTEM, spot)).toBe(true);
    expect(megastructureRefusal(nexus, spot, rows, types)).toBe(BODY_HAS_MEGASTRUCTURE);
    expect(megastructureRefusal(complex, spot, rows, types)).toBeNull();
    expect(await adds().add("habitat_central_complex")).toBe(true);
    expect(mockedIpc.addHabitat.mock.calls).toEqual([[SYSTEM, 12, "habitat_central_complex"]]);
  });
});
