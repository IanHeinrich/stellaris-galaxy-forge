import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import {
  colonyPage,
  megastructureSummary,
  name,
  planetPage,
  planetSummary,
  systemDetails,
} from "../test/builders";
import { openFixtureSave } from "./editorFixture";
import { editResult } from "./fixture";
import { useInspectorStore } from "./inspectorStore";
import { deleteRingWorld } from "./ringWorldRemoval";

const SOL = 0;

/** A segment of class `kind`, numbered `id`, colonised when `colonised`. */
function segment(id: number, kind: string, colonised = false) {
  return planetSummary({ id, class: kind, colonised });
}

/**
 * Sol holding a ring of four segments, a moon of one of them, two ruined sections, and the
 * Interloper and the star, which stay.
 */
function armRing(colonised: readonly number[]): void {
  mockedIpc.getSystemDetails.mockResolvedValue([
    systemDetails({
      id: SOL,
      planets: [
        planetSummary({ id: 2444, class: "pc_g_star" }),
        segment(2445, "pc_ringworld_tech", colonised.includes(2445)),
        segment(2446, "pc_ringworld_seam_damaged"),
        segment(2447, "pc_shattered_ring_habitable", colonised.includes(2447)),
        segment(2448, "pc_ringworld_habitable", colonised.includes(2448)),
        planetSummary({ id: 2452, moon: true, parent: 2448 }),
        planetSummary({ id: 2450, class: "pc_shattered_2" }),
      ],
      megastructures: [
        megastructureSummary({ id: 10, kind: "ring_world_ruined" }),
        megastructureSummary({ id: 11, kind: "ring_world_ruined" }),
        megastructureSummary({ id: 12, kind: "dyson_swarm_1" }),
      ],
    }),
  ]);
  mockedIpc.getPlanetPage.mockImplementation(async (id: number) =>
    planetPage({
      id,
      name: name(`Section ${id}`),
      name_key: `Section ${id}`,
      colony: colonyPage({ id: id - 2400 }),
      owner: 42,
    }),
  );
}

const labels = () => useInspectorStore.getState().stack.map((e) => e.label);
const asked = () => mockedIpc.confirm.mock.calls[0]?.[0];

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.confirm.mockResolvedValue(true);
  mockedIpc.deleteRingWorld.mockResolvedValue(editResult());
});

describe("deleting a ring world", () => {
  it("names every colony when several go", async () => {
    armRing([2445, 2447, 2448]);
    await deleteRingWorld(SOL);
    expect(asked()).toBe(
      "Delete the ring world in Sol? Its 5 planets are removed from the save. The colonies on Section 2445, Section 2447 and Section 2448 go with it, with their pops, buildings and defence armies.",
    );
  });

  it("asks without colonies for an uncolonised ring", async () => {
    armRing([]);
    await deleteRingWorld(SOL);
    expect(asked()).toBe("Delete the ring world in Sol? Its 5 planets are removed from the save.");
    expect(mockedIpc.getPlanetPage).not.toHaveBeenCalled();
  });

  it("closes the page of a section the ring had", async () => {
    armRing([]);
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: SOL }, label: "Sol" },
        { ref: { kind: "megastructure", id: 11 }, label: "Ruined Ring World" },
      ],
    });
    await deleteRingWorld(SOL);
    expect(labels()).toEqual(["Sol"]);
  });

  it("lands on the system's page when the inspector was opened on a section", async () => {
    armRing([]);
    useInspectorStore.setState({
      stack: [{ ref: { kind: "body", system: SOL, id: 2446 }, label: "Section 2446" }],
    });
    await deleteRingWorld(SOL);
    expect(useInspectorStore.getState().stack).toEqual([
      { ref: { kind: "system", id: SOL }, label: "Sol" },
    ]);
  });
});
