import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { deleteQuestion, removeColonyQuestion } from "../lib/details/planetRemoval";
import { mockedIpc } from "../test/ipc";
import { name, planetPage } from "../test/builders";
import { openFixtureSave, sessionError } from "./editorFixture";
import { editResult } from "./fixture";
import { useInspectorStore } from "./inspectorStore";
import { deletePlanet, removeColony } from "./planetRemoval";

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
const MOON = {
  id: 1208,
  name: name("NAME_Moon"),
  name_key: "NAME_Moon",
  class: "pc_barren",
  size: 6,
};

/** An inspector showing the system, the planet above it, and its colony above that. */
function onTheColony(): void {
  useInspectorStore.setState({
    stack: [
      { ref: { kind: "system", id: 1 }, label: "Sol" },
      { ref: { kind: "body", system: 1, id: 1207 }, label: "Terra" },
      { ref: { kind: "colony", id: 18 }, label: "Colony #18" },
    ],
  });
}

const labels = () => useInspectorStore.getState().stack.map((e) => e.label);

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.confirm.mockResolvedValue(true);
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("the confirms say what goes", () => {
  it("adds the colonies on its moons to a colonised planet's", () => {
    const colonised = planetPage({ colony: COLONY, owner: 0, moons: [MOON, MOON] });
    expect(deleteQuestion(colonised, "Terra", false, 2)).toBe(
      "Delete Terra and its 2 moons? Its colony goes with it: 3,400 pops, 2 buildings, its defence armies and any orbital ring. The colonies on 2 of its moons go too.",
    );
  });

  it("names the moons, and the colony's pops, buildings, armies and ring", () => {
    const bare = planetPage({ moons: [MOON] });
    expect(deleteQuestion(bare, "Terra", false)).toBe(
      "Delete Terra and its 1 moon? The planet is removed from the save.",
    );
    const colonised = planetPage({ colony: COLONY, owner: 0 });
    expect(deleteQuestion(colonised, "Luna", true)).toBe(
      "Delete Luna? Its colony goes with it: 3,400 pops, 2 buildings, its defence armies and any orbital ring.",
    );
    expect(removeColonyQuestion(colonised, "Terra")).toBe(
      "Remove the colony on Terra? It goes with 3,400 pops, 2 buildings, its defence armies and any orbital ring. The planet stays, with no owner.",
    );
  });
});

describe("deleting a planet", () => {
  it("asks, deletes the planet with its moons, and goes back to the system", async () => {
    mockedIpc.getPlanetPage.mockResolvedValue(
      planetPage({ moons: [MOON], colony: COLONY, owner: 0 }),
    );
    onTheColony();

    expect(await deletePlanet(1207, "Terra", false)).toBe(true);

    expect(mockedIpc.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Its colony goes with it"),
      expect.objectContaining({ title: "Terra", kind: "warning" }),
    );
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "DeleteBody", body: 1207 });
    expect(labels()).toEqual(["Sol"]);
  });

  it("names a colonised moon in the confirm and closes its colony's page", async () => {
    const MOON_COLONY = { ...COLONY, id: 40 };
    mockedIpc.getPlanetPage.mockImplementation(async (id) =>
      id === 1207
        ? planetPage({ moons: [MOON] })
        : planetPage({ id: 1208, colony: MOON_COLONY, owner: 0 }),
    );
    useInspectorStore.setState({
      stack: [
        { ref: { kind: "system", id: 1 }, label: "Sol" },
        { ref: { kind: "colony", id: 40 }, label: "Colony #40" },
      ],
    });

    expect(await deletePlanet(1207, "Terra", false)).toBe(true);

    expect(mockedIpc.confirm).toHaveBeenCalledWith(
      "Delete Terra and its 1 moon? The colony on 1 of its moons goes with it, with its pops, buildings, defence armies and any orbital rings.",
      expect.anything(),
    );
    expect(labels()).toEqual(["Sol"]);
  });

  it("writes nothing when the user declines", async () => {
    mockedIpc.getPlanetPage.mockResolvedValue(planetPage());
    mockedIpc.confirm.mockResolvedValueOnce(false);
    onTheColony();

    expect(await deletePlanet(1207, "Terra", false)).toBe(false);

    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(labels()).toEqual(["Sol", "Terra", "Colony #18"]);
  });

  it("says which moon it could not read, and asks nothing", async () => {
    mockedIpc.getPlanetPage.mockImplementation(async (id) => {
      if (id === 1207)
        return planetPage({ moons: [{ ...MOON, name: name("Luna"), name_key: "Luna" }] });
      throw { kind: "entity", message: "no planet 1208" };
    });
    onTheColony();

    expect(await deletePlanet(1207, "Terra", false)).toBe(false);

    expect(sessionError()).toBe(
      "Couldn't read Luna, a moon of Terra, so nothing was deleted: no planet 1208",
    );
    expect(mockedIpc.confirm).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(labels()).toEqual(["Sol", "Terra", "Colony #18"]);
  });

  it("keeps the pages open when the core refuses", async () => {
    mockedIpc.getPlanetPage.mockResolvedValue(planetPage());
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "planet 1207 is a star" });
    onTheColony();

    expect(await deletePlanet(1207, "Terra", false)).toBe(false);

    expect(sessionError()).toBe("planet 1207 is a star");
    expect(labels()).toEqual(["Sol", "Terra", "Colony #18"]);
  });
});

describe("removing a colony", () => {
  it("asks, removes the colony, and leaves the planet's page open", async () => {
    mockedIpc.getPlanetPage.mockResolvedValue(planetPage({ colony: COLONY, owner: 0 }));
    onTheColony();

    expect(await removeColony(1207, "Terra")).toBe(true);

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "RemoveColony", body: 1207 });
    expect(labels()).toEqual(["Sol", "Terra"]);
  });

  it("does nothing on a planet with no colony", async () => {
    mockedIpc.getPlanetPage.mockResolvedValue(planetPage());

    expect(await removeColony(1207, "Terra")).toBe(false);

    expect(mockedIpc.confirm).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
