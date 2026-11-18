import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { confirm } from "@tauri-apps/plugin-dialog";
import type { AmbientObject } from "../generated/AmbientObject";
import { megastructureSummary, rowOrigin, structureSpawn, systemDetails } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { systemSpawn } from "../test/spawn";
import { bindStores } from "./bindStores";
import { useDetailsStore } from "./detailsStore";
import { openFixtureScenario } from "./editorFixture";
import { editResult } from "./fixture";
import { useInspectorStore } from "./inspectorStore";
import { removeAmbientObject } from "./placedRemoval";

bindStores();

const SYS = 2;
const OBJECT = 0x6000_0081;
const labels = () => useInspectorStore.getState().stack.map((e) => e.label);

/** The inspector on Kel, with the page of each of `ids` above it. */
function pages(...ids: number[]): void {
  useInspectorStore.setState({
    stack: [
      { ref: { kind: "system", id: SYS }, label: "Kel" },
      ...ids.map((id) => ({
        ref: { kind: "ambient_object", system: SYS, id } as const,
        label: `Object ${id}`,
      })),
    ],
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await openFixtureScenario();
  const object = (id: number | null): AmbientObject => ({
    kind: "derelict_ship_object",
    place: id === null ? { place: "random" } : { place: "point", x: 0, y: 30 },
    origin: rowOrigin(id),
  });
  const ambient_objects = [null, OBJECT - 1, OBJECT, OBJECT + 1].map(object);
  useDetailsStore.setState({
    details: new Map([[SYS, systemDetails({ id: SYS, spawn: systemSpawn({ ambient_objects }) })]]),
  });
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("deleting an ambient object", () => {
  it("asks, then takes it out with RemoveAmbientObject and closes its page", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    pages(OBJECT);
    expect(await removeAmbientObject(OBJECT, "Derelict Ship", null)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      "Delete Derelict Ship? It is removed from the scenario.",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "RemoveAmbientObject",
      ambient_object: OBJECT,
    });
    expect(labels()).toEqual(["Kel"]);
  });

  it("closes the page of every later object of the system, whose ids move down, and keeps an earlier one's", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    pages(OBJECT + 1);
    expect(await removeAmbientObject(OBJECT, "Derelict Ship", SYS)).toBe(true);
    expect(labels()).toEqual(["Kel"]);

    pages(OBJECT - 1);
    expect(await removeAmbientObject(OBJECT, "Derelict Ship", SYS)).toBe(true);
    expect(labels()).toEqual(["Kel", `Object ${OBJECT - 1}`]);
  });

  it("leaves it when the player says no", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    expect(await removeAmbientObject(OBJECT, "Derelict Ship", SYS)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("the pages of a scenario's placed rows after an edit", () => {
  const RUIN = 0x5800_0081;
  const object = (kind: string, id: number): AmbientObject => ({
    kind,
    place: { place: "point", x: id - OBJECT, y: 30 },
    origin: rowOrigin(id),
  });
  const ruin = (kind: string, id: number) =>
    megastructureSummary({ id, kind, at: [id - RUIN, 0], spawn: structureSpawn(rowOrigin(id)) });

  /** The system's details as an edit leaves them: its ambient objects and ruins, in block order. */
  function landed(objects: string[], ruins: string[]): void {
    const details = systemDetails({
      id: SYS,
      megastructures: ruins.map((kind, i) => ruin(kind, RUIN + i)),
      spawn: systemSpawn({ ambient_objects: objects.map((kind, i) => object(kind, OBJECT + i)) }),
    });
    useDetailsStore.setState({ details: new Map([[SYS, details]]) });
  }

  function onPages(): void {
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: SYS }, label: "Kel" },
        { ref: { kind: "ambient_object", system: SYS, id: OBJECT + 1 }, label: "Object" },
        { ref: { kind: "megastructure", id: RUIN + 1 }, label: "Ruin" },
      ],
    });
  }

  it("closes the page whose id an undone deletion gave to another row, for objects and ruins alike", () => {
    landed(["a", "c"], ["dyson", "gateway"]);
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: SYS }, label: "Kel" },
        { ref: { kind: "megastructure", id: RUIN + 1 }, label: "Ruin" },
      ],
    });
    landed(["a", "c"], ["dyson", "assembly", "gateway"]);
    expect(labels()).toEqual(["Kel"]);

    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: SYS }, label: "Kel" },
        { ref: { kind: "ambient_object", system: SYS, id: OBJECT + 1 }, label: "Object" },
      ],
    });
    landed(["a", "b", "c"], ["dyson", "assembly", "gateway"]);
    expect(labels()).toEqual(["Kel"]);
  });

  it("keeps the pages when an add appends a row, or a move leaves the count as it was", () => {
    landed(["a", "c"], ["dyson", "gateway"]);
    onPages();
    landed(["a", "c", "d"], ["dyson", "gateway", "assembly"]);
    expect(labels()).toEqual(["Kel", "Object", "Ruin"]);

    const moved = useDetailsStore.getState().details.get(SYS)!;
    const objects = moved.spawn!.ambient_objects.map((o) => ({
      ...o,
      place: { place: "point", x: 99, y: 99 } as const,
    }));
    useDetailsStore.setState({
      details: new Map([[SYS, { ...moved, spawn: { ...moved.spawn!, ambient_objects: objects } }]]),
    });
    expect(labels()).toEqual(["Kel", "Object", "Ruin"]);
  });
});
