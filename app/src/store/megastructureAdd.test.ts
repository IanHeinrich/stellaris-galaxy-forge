import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { MEGASTRUCTURES_NEED_GAME_DATA, RELAY_RADIUS_FACTOR } from "../lib/megastructurePicks";
import { mockedIpc } from "../test/ipc";
import { inSystem } from "../test/session";
import { megastructureTypeView, systemDetails } from "../test/builders";
import { openFixtureSave, sessionError } from "./editorFixture";
import { editResult } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useMegastructureAddStore } from "./megastructureAdd";

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
  });
});

describe("adding a megastructure from the system view", () => {
  it("stands a relay just outside the inner radius at the angle pressed, and closes the dialog", async () => {
    expect(adds().open(SYSTEM, { kind: "space", x: -60, y: 80 })).toBe(true);
    expect(await adds().add("hyper_relay", 3)).toBe(true);

    expect(adds().prompt).toBeNull();
    const [system, kind, place, owner] = mockedIpc.addMegastructure.mock.calls[0];
    expect([system, kind, owner]).toEqual([SYSTEM, "hyper_relay", 3]);
    if (place.place !== "free") throw new Error(`placed on body ${place.body}`);
    const radius = RELAY_RADIUS_FACTOR * 150;
    expect(place.x).toBeCloseTo((radius * -60) / 100);
    expect(place.y).toBeCloseTo((radius * 80) / 100);
  });

  it("stands a type built inside the gravity well where pressed, and ties a body's to the body", async () => {
    adds().open(SYSTEM, { kind: "space", x: 30, y: 40 });
    await adds().add("shroud_seal", null);
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    await adds().add("think_tank_3", null);

    expect(mockedIpc.addMegastructure.mock.calls.map(([, , place]) => place)).toEqual([
      { place: "free", x: 30, y: 40 },
      { place: "body", body: 12 },
    ]);
  });

  it("opens the new megastructure's page, named as the game names it", async () => {
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });
    await adds().add("think_tank_3", 0);

    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1]).toEqual({
      ref: { kind: "megastructure", id: 16 },
      label: "Science Nexus",
    });
  });

  it("opens no page when the core refuses the add", async () => {
    mockedIpc.addMegastructure.mockRejectedValue({ kind: "op", message: "a refusal" });
    adds().open(SYSTEM, { kind: "body", body: 12, star: false });

    expect(await adds().add("think_tank_3", 0)).toBe(false);
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
