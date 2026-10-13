import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EntityAddr } from "../generated/EntityAddr";
import { mockedIpc } from "../test/ipc";
import { colonyPage, megastructureTypeView, name, planetPage } from "../test/builders";
import { openFixtureSave } from "./editorFixture";
import { editResult, entityNode, entityView, scalar } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { deleteMegastructure } from "./megastructureRemoval";

const NEXUS = 359;
const WORLD = 517;

/** Whether the planet's flags say a megastructure made it. */
let madeIt = false;

/** The file's bytes for a row it held; an added row has none. */
let rowSpan: [number, number] = [1200, 1480];

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
      ? entityView("megastructure", { addr, nodes, span: rowSpan })
      : entityView("planet", { addr, path: ["flags"], nodes: madeIt ? flags : [] }),
  );
}

/** An inspector showing the system, the structure's page above it, and a colony's above that. */
function onTheStructure(): void {
  useInspectorStore.setState({
    stack: [
      { ref: { kind: "system", id: 338 }, label: "Ostiuq" },
      { ref: { kind: "megastructure", id: NEXUS }, label: "Science Nexus" },
      { ref: { kind: "colony", id: colonyPage().id }, label: "Colony #18" },
    ],
  });
}

const labels = () => useInspectorStore.getState().stack.map((e) => e.label);
const asked = () => mockedIpc.confirm.mock.calls[0]?.[0];

beforeEach(async () => {
  await openFixtureSave();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  madeIt = false;
  rowSpan = [1200, 1480];
  mockedIpc.confirm.mockResolvedValue(true);
  mockedIpc.deleteMegastructure.mockResolvedValue(editResult());
});

describe("deleting a megastructure", () => {
  it("says nothing of what stays for a row added this session, whose add is taken back", async () => {
    rowSpan = [5000, 5000];
    armRow("think_tank_3", null);
    await deleteMegastructure(NEXUS, "Science Nexus", 0);
    expect(asked()).toBe("Delete Science Nexus in Sol? It is removed from the save.");
  });

  it("asks the same for a relay", async () => {
    armRow("hyper_relay", null, 23);
    await deleteMegastructure(NEXUS, "Hyper Relay", null);
    expect(asked()).toBe(
      "Delete Hyper Relay? It is removed from the save. Without game data, the modifiers its construction added stay.",
    );
  });

  it("takes the colony first on a planet the megastructure made, and closes its page", async () => {
    madeIt = true;
    armRow("cosmogenesis_world", WORLD);
    mockedIpc.getPlanetPage.mockResolvedValue(
      planetPage({
        id: WORLD,
        name: name("Genesis"),
        name_key: "Genesis",
        colony: colonyPage(),
        owner: 0,
        flags: 1,
      }),
    );
    onTheStructure();

    expect(await deleteMegastructure(NEXUS, "Cosmogenesis World", 0)).toBe(true);

    expect(asked()).toBe(
      "Delete Cosmogenesis World in Sol? It is removed from the save. The colony on Genesis goes with it: 3,400 pops, 2 buildings, its defence armies and any orbital ring. The planet stays. Without game data, the modifiers its construction added stay.",
    );
    expect(mockedIpc.getEntity).toHaveBeenCalledWith({ kind: "planet", id: WORLD }, ["flags"]);
    expect(labels()).toEqual(["Ostiuq"]);
  });

  it("leaves an ordinary colony with an Orbital Ring out of the confirm and its page open", async () => {
    armRow("orbital_ring_tier_1", WORLD);
    mockedIpc.getPlanetPage.mockResolvedValue(
      planetPage({ id: WORLD, colony: colonyPage(), owner: 0, flags: 2 }),
    );
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: 338 }, label: "Ostiuq" },
        { ref: { kind: "colony", id: colonyPage().id }, label: "Colony #18" },
      ],
    });

    expect(await deleteMegastructure(NEXUS, "Orbital Ring", 0)).toBe(true);

    expect(asked()).not.toContain("colony");
    expect(labels()).toEqual(["Ostiuq", "Colony #18"]);
  });

  it("leaves out the game data warning once the game data is loaded", async () => {
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
    expect(asked()).toBe("Delete Arc Furnace in Sol? It is removed from the save.");

    mockedIpc.confirm.mockClear();
    armRow("think_tank_3", null);
    await deleteMegastructure(NEXUS, "Science Nexus", 0);
    expect(asked()).toBe("Delete Science Nexus in Sol? It is removed from the save.");
  });
});
