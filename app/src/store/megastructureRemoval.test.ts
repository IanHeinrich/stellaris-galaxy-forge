import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EntityAddr } from "../generated/EntityAddr";
import { mockedIpc } from "../test/ipc";
import { megastructureTypeView, name, planetPage } from "../test/builders";
import { openFixtureSave, sessionError } from "./editorFixture";
import { editResult, entityNode, entityView, scalar } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { deleteMegastructure } from "./megastructureRemoval";

const NEXUS = 359;
const WORLD = 517;
const COLONY = {
  id: 18,
  colonised: "2200.01.01",
  final_designation: null,
  designation: null,
  pops: 3400,
  species: [],
  districts: [],
  zones: [],
  buildings: ["building_factory_1", "building_foundry_1"],
};

/** Whether the planet's flags say a megastructure made it. */
let madeIt = false;

/** The megastructure row the core reads back: its type, its planet and its bypass. */
function armRow(kind: string, planet: number | null, bypass: number | null = null): void {
  const nodes = [
    entityNode("type", scalar(kind, "quoted")),
    entityNode("planet", scalar(String(planet ?? 4294967295), "int")),
    ...(bypass === null ? [] : [entityNode("bypass", scalar(String(bypass), "int"))]),
  ];
  const flags = [entityNode("megastructure", scalar("62808000", "int"))];
  mockedIpc.getEntity.mockImplementation(async (addr: EntityAddr) =>
    addr.kind === "megastructure"
      ? entityView("megastructure", { addr, nodes })
      : entityView("planet", { addr, path: ["flags"], nodes: madeIt ? flags : [] }),
  );
}

/** An inspector showing the system, the structure's page above it, and a colony's above that. */
function onTheStructure(): void {
  useInspectorStore.setState({
    stack: [
      { ref: { kind: "system", id: 338 }, label: "Ostiuq" },
      { ref: { kind: "megastructure", id: NEXUS }, label: "Science Nexus" },
      { ref: { kind: "colony", id: COLONY.id }, label: "Colony #18" },
    ],
  });
}

const labels = () => useInspectorStore.getState().stack.map((e) => e.label);
const asked = () => mockedIpc.confirm.mock.calls[0]?.[0];

beforeEach(async () => {
  await openFixtureSave();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  madeIt = false;
  mockedIpc.confirm.mockResolvedValue(true);
  mockedIpc.deleteMegastructure.mockResolvedValue(editResult());
});

describe("deleting a megastructure", () => {
  it("asks, deletes the row, and goes back to the system's page", async () => {
    armRow("think_tank_3", null);
    onTheStructure();

    expect(await deleteMegastructure(NEXUS, "Science Nexus", 0)).toBe(true);

    expect(mockedIpc.confirm).toHaveBeenCalledWith(
      "Delete Science Nexus in Sol? It is removed from the save. Without game data, the modifiers its construction added stay. What it did to its system stays as the game left it.",
      expect.objectContaining({ title: "Science Nexus", kind: "warning" }),
    );
    expect(mockedIpc.deleteMegastructure).toHaveBeenCalledWith(NEXUS);
    expect(labels()).toEqual(["Ostiuq"]);
  });

  it("writes nothing when the user declines", async () => {
    armRow("think_tank_3", null);
    mockedIpc.confirm.mockResolvedValueOnce(false);
    onTheStructure();

    expect(await deleteMegastructure(NEXUS, "Science Nexus", 0)).toBe(false);

    expect(mockedIpc.deleteMegastructure).not.toHaveBeenCalled();
    expect(labels()).toEqual(["Ostiuq", "Science Nexus", "Colony #18"]);
  });

  it("says a relay's link and a gateway's go with it", async () => {
    armRow("hyper_relay", null, 23);
    await deleteMegastructure(NEXUS, "Hyper Relay", null);
    expect(asked()).toBe(
      "Delete Hyper Relay? It is removed from the save. Its relay link goes too. Without game data, the modifiers its construction added stay. What it did to its system stays as the game left it.",
    );

    mockedIpc.confirm.mockClear();
    armRow("gateway_ruined", null, 3);
    await deleteMegastructure(NEXUS, "Derelict Gateway", null);
    expect(asked()).toContain(" Its link to the other gateways goes too. ");
  });

  it("takes the colony first on a planet the megastructure made, and closes its page", async () => {
    madeIt = true;
    armRow("cosmogenesis_world", WORLD);
    mockedIpc.getPlanetPage.mockResolvedValue(
      planetPage({
        id: WORLD,
        name: name("Genesis"),
        name_key: "Genesis",
        colony: COLONY,
        owner: 0,
        flags: 1,
      }),
    );
    onTheStructure();

    expect(await deleteMegastructure(NEXUS, "Cosmogenesis World", 0)).toBe(true);

    expect(asked()).toBe(
      "Delete Cosmogenesis World in Sol? It is removed from the save. The colony on Genesis goes with it: 3,400 pops, 2 buildings, its defence armies and any orbital ring. The planet stays. Without game data, the modifiers its construction added stay. What it did to its system and planet stays as the game left it.",
    );
    expect(mockedIpc.getEntity).toHaveBeenCalledWith({ kind: "planet", id: WORLD }, ["flags"]);
    expect(labels()).toEqual(["Ostiuq"]);
  });

  it("leaves an ordinary colony with an Orbital Ring out of the confirm and its page open", async () => {
    armRow("orbital_ring_tier_1", WORLD);
    mockedIpc.getPlanetPage.mockResolvedValue(
      planetPage({ id: WORLD, colony: COLONY, owner: 0, flags: 2 }),
    );
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: 338 }, label: "Ostiuq" },
        { ref: { kind: "colony", id: COLONY.id }, label: "Colony #18" },
      ],
    });

    expect(await deleteMegastructure(NEXUS, "Orbital Ring", 0)).toBe(true);

    expect(asked()).not.toContain("colony");
    expect(asked()).toContain("its system and planet");
    expect(labels()).toEqual(["Ostiuq", "Colony #18"]);
  });

  it("says what the game data says its construction added goes too", async () => {
    useGameDataStore.setState({
      status: "ready",
      megastructureTypes: new Map([
        [
          "orbital_arc_furnace_4",
          megastructureTypeView("orbital_arc_furnace_4", {
            dismantle: {
              modifiers: ["orbital_arc_furnace_4_mod"],
              deposits: ["d_arc_furnace_4"],
              variables: [{ variable: "arc_furnace_counter", by: 1 }],
            },
          }),
        ],
      ]),
    });
    armRow("orbital_arc_furnace_4", null);
    await deleteMegastructure(NEXUS, "Arc Furnace", 0);
    expect(asked()).toBe(
      "Delete Arc Furnace in Sol? It is removed from the save. The modifiers, deposits and counters its construction added go too. Anything else it did to its system stays as the game left it.",
    );

    mockedIpc.confirm.mockClear();
    armRow("think_tank_3", null);
    await deleteMegastructure(NEXUS, "Science Nexus", 0);
    expect(asked()).toBe(
      "Delete Science Nexus in Sol? It is removed from the save. What it did to its system stays as the game left it.",
    );
  });

  it("says what it could not read, and asks nothing", async () => {
    mockedIpc.getEntity.mockRejectedValue({ kind: "entity", message: "no megastructure 359" });
    onTheStructure();

    expect(await deleteMegastructure(NEXUS, "Science Nexus", 0)).toBe(false);

    expect(sessionError()).toBe(
      "Couldn't read Science Nexus, so nothing was deleted: no megastructure 359",
    );
    expect(mockedIpc.confirm).not.toHaveBeenCalled();
    expect(mockedIpc.deleteMegastructure).not.toHaveBeenCalled();
  });

  it("keeps the pages open when the core refuses", async () => {
    armRow("lgate_base", null);
    mockedIpc.deleteMegastructure.mockRejectedValueOnce({
      kind: "op",
      message: "megastructure 0 is kept",
    });
    onTheStructure();

    expect(await deleteMegastructure(NEXUS, "L-Gate", 0)).toBe(false);

    expect(sessionError()).toBe("megastructure 0 is kept");
    expect(labels()).toEqual(["Ostiuq", "Science Nexus", "Colony #18"]);
  });
});
