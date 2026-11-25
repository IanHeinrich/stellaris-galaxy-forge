import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EntityAddr } from "../generated/EntityAddr";
import { mockedIpc } from "../test/ipc";
import {
  colonyPage,
  megastructureSummary,
  megastructureTypeView,
  planetPage,
  rowOrigin,
  structureSpawn,
  systemDetails,
} from "../test/builders";
import { useDetailsStore } from "./detailsStore";
import { openFixtureSave } from "./editorFixture";
import { editResult, entityNode, entityView, scalar } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { deleteMegastructure, removeRuin } from "./megastructureRemoval";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openFixtureScenario } from "./editorFixture";

const NEXUS = 359;
const WORLD = 517;

/** The file's bytes for a row it held; an added row has none. */
let rowSpan: [number, number] = [1200, 1480];

/** The megastructure row the core reads back: its type, its planet, whose flags name a megastructure, and its bypass. */
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
      : entityView("planet", { addr, path: ["flags"], nodes: flags }),
  );
}

const labels = () => useInspectorStore.getState().stack.map((e) => e.label);
const asked = () => mockedIpc.confirm.mock.calls[0]?.[0];

beforeEach(async () => {
  await openFixtureSave();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
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
      "Delete Hyper Relay? It is removed from the save. Game data isn't loaded, so the modifiers from building it stay.",
    );
  });

  it.each([
    ["orbital_ring_tier_1", "Orbital Ring"],
    ["cosmogenesis_world_0", "Cosmogenesis World"],
    ["galactic_halls_0_militarist", "Galactic Hall"],
  ])("leaves the colony under %s out of the confirm and its page open", async (kind, title) => {
    armRow(kind, WORLD);
    mockedIpc.getPlanetPage.mockResolvedValue(
      planetPage({ id: WORLD, colony: colonyPage(), owner: 0, flags: 2 }),
    );
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: 338 }, label: "Ostiuq" },
        { ref: { kind: "colony", id: colonyPage().id }, label: "Colony #18" },
        { ref: { kind: "megastructure", id: NEXUS }, label: title },
      ],
    });

    expect(await deleteMegastructure(NEXUS, title, 0)).toBe(true);

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

describe("removeRuin", () => {
  const RUIN = 0x5800_0080;

  beforeEach(async () => {
    vi.clearAllMocks();
    await openFixtureScenario();
    useInspectorStore.setState({
      stack: [{ ref: { kind: "megastructure", id: RUIN }, label: "Ruined Dyson Sphere" }],
    });
  });

  it("asks, then takes the ruin out with RemoveMegastructure and closes its page", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    expect(await removeRuin(RUIN, "Ruined Dyson Sphere", null)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      "Delete Ruined Dyson Sphere? It is removed from the scenario.",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "RemoveMegastructure",
      megastructure: RUIN,
    });
    expect(labels()).not.toContain("Ruined Dyson Sphere");
  });

  it("closes the page of every later ruin of the system, whose ids move down, and keeps an earlier one's", async () => {
    const SYS = 2;
    const ruinRow = (id: number) =>
      megastructureSummary({ id, kind: "gateway_ruined", spawn: structureSpawn(rowOrigin(id)) });
    const rows = [
      megastructureSummary({
        id: 70,
        kind: "dyson_sphere_ruined",
        spawn: structureSpawn(rowOrigin(null)),
      }),
      ...[RUIN - 1, RUIN, RUIN + 1].map(ruinRow),
    ];
    useDetailsStore.setState({
      details: new Map([[SYS, systemDetails({ id: SYS, megastructures: rows })]]),
    });
    vi.mocked(confirm).mockResolvedValue(true);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const pages = (...ids: number[]) =>
      useInspectorStore.setState({
        stack: [
          { ref: { kind: "system", id: SYS }, label: "Kel" },
          ...ids.map((id) => ({
            ref: { kind: "megastructure", id } as const,
            label: `Ruin ${id}`,
          })),
        ],
      });

    pages(RUIN + 1);
    expect(await removeRuin(RUIN, "Ruined Gateway", SYS)).toBe(true);
    expect(labels()).toEqual(["Kel"]);

    pages(RUIN - 1);
    expect(await removeRuin(RUIN, "Ruined Gateway", SYS)).toBe(true);
    expect(labels()).toEqual(["Kel", `Ruin ${RUIN - 1}`]);
  });

  it("leaves the ruin when the player says no", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    expect(await removeRuin(RUIN, "Ruined Dyson Sphere", null)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
