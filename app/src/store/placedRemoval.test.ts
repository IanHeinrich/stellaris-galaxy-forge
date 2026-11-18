import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { confirm } from "@tauri-apps/plugin-dialog";
import type { AmbientObject } from "../generated/AmbientObject";
import { rowOrigin, systemDetails } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { systemSpawn } from "../test/spawn";
import { useDetailsStore } from "./detailsStore";
import { openFixtureScenario } from "./editorFixture";
import { editResult } from "./fixture";
import { useInspectorStore } from "./inspectorStore";
import { removeAmbientObject } from "./placedRemoval";

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
