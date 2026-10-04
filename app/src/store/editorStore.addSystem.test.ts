import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { SystemNode } from "../generated/SystemNode";
import { NEEDS_GAME_DATA, NEEDS_STELLARIS_4 } from "../lib/addSystem";
import {
  addedNode,
  editor,
  openFixtureSave,
  sessionError,
  withAddedSystems,
} from "./editorFixture";
import { addSystemRefusalAt } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { loadGameData } from "./gameDataFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useGeneratorStore } from "./generatorStore";
import { useInspectorStore } from "./inspectorStore";
import { editResult, saveMeta } from "./fixture";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";

const addRandomSystem = mockedIpc.addRandomSystem;
const addSpecialSystem = mockedIpc.addSpecialSystem;
const rerollSystem = mockedIpc.rerollSystem;
beforeEach(async () => {
  await openFixtureSave();
  await loadGameData();
});

describe("adding a system to a save", () => {
  it("rolls one at the point in one edit and selects it", async () => {
    const system = addedNode(6, -50, -20);
    addRandomSystem.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    mockedIpc.getSystem.mockResolvedValueOnce({ system, neighbours: [], nebula: null });

    expect(await editor().addRandomSystemAt(-50, -20, "sc_m")).toBe(true);

    const [seed, x, y, starClass] = addRandomSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, starClass]).toEqual([-50, -20, "sc_m"]);
    expect(editor().selection).toEqual([6]);
    expect(editor().inspected?.system.id).toBe(6);
  });

  it("gives each roll a fresh seed", async () => {
    addRandomSystem.mockResolvedValue(editResult({ delta: { systems: [] } }));
    await editor().addRandomSystemAt(-50, -20);
    await editor().addRandomSystemAt(-50, -20);
    const [first, second] = addRandomSystem.mock.calls.map(([seed]) => seed);
    expect(first).not.toBe(second);
  });

  it("undoing the add clears the selection", async () => {
    const system = addedNode(6, -50, -20);
    addRandomSystem.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    mockedIpc.getSystem.mockResolvedValueOnce({ system, neighbours: [], nebula: null });
    await editor().addRandomSystemAt(-50, -20);
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: [6] }, history: { undo: [], redo: [] } }),
    );

    await editor().undo();

    expect(editor().selection).toEqual([]);
    expect(editor().inspected).toBeNull();
  });

  it("reports a refused spot without asking the core", async () => {
    expect(await editor().addRandomSystemAt(3, 0)).toBe(false);
    expect(addRandomSystem).not.toHaveBeenCalled();
    expect(sessionError()).toMatch(/^Too close to .+: 3 away, the game needs 10$/);
  });
});

describe("adding a planet or moon to a save system", () => {
  const at = { radius: 150, angle: 307 };

  it("rolls the body in one edit and shows it alone, with its page open", async () => {
    mockedIpc.addBody.mockResolvedValueOnce({
      edit: editResult({ details_stale: [0] }),
      planet: 20,
    });

    expect(await editor().addBodyAt(0, at, null, "pc_desert")).toBe(true);

    const [system, parent, planetClass, size, radius, angle, seed] =
      mockedIpc.addBody.mock.calls[0];
    expect([system, parent, planetClass, size, radius, angle]).toEqual([
      0,
      null,
      "pc_desert",
      null,
      150,
      307,
    ]);
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(editor().history.undo).toHaveLength(1);
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "body", system: 0, id: 20 });
  });

  it("asks for a random moon of a planet", async () => {
    mockedIpc.addBody.mockResolvedValueOnce({ edit: editResult(), planet: 21 });
    expect(await editor().addBodyAt(0, { radius: 25, angle: 0 }, 2)).toBe(true);
    expect(mockedIpc.addBody.mock.calls[0].slice(0, 6)).toEqual([0, 2, null, null, 25, 0]);
  });

  it("reports a refusal and opens nothing", async () => {
    const stack = useInspectorStore.getState().stack;
    mockedIpc.addBody.mockRejectedValueOnce({ kind: "op", message: "planet 1 is a star" });
    expect(await editor().addBodyAt(0, at, 1)).toBe(false);
    expect(sessionError()).toBe("planet 1 is a star");
    expect(useInspectorStore.getState().stack).toEqual(stack);
  });

  it("is refused without game data, without asking the core", async () => {
    useGameDataStore.setState({ status: "idle" });
    expect(await editor().addBodyAt(0, at)).toBe(false);
    expect(mockedIpc.addBody).not.toHaveBeenCalled();
    expect(sessionError()).toBe("Load game data to add a planet or moon.");
  });

  it("reads the classes a planet and a moon may take once per loaded game data", async () => {
    const desert = { key: "pc_desert", name: "Desert", min_size: 10, max_size: 25 };
    const barren = { key: "pc_barren", name: "Barren", min_size: 5, max_size: 8 };
    mockedIpc.getBodyClasses.mockImplementation(async (moon) => (moon ? [barren] : [desert]));
    useGeneratorStore.getState().requestBodyClasses();
    useGeneratorStore.getState().requestBodyClasses();
    await until(() => expect(useGeneratorStore.getState().moonClasses).toEqual([barren]));
    expect(useGeneratorStore.getState().planetClasses).toEqual([desert]);
    expect(mockedIpc.getBodyClasses).toHaveBeenCalledTimes(2);
  });
});

describe("placing a special layout", () => {
  const trappist = (extra: Partial<SystemNode> = {}) =>
    addedNode(6, -50, -20, { initializer: "trappist_initializer", star_class: "sc_m", ...extra });

  it("adds it at the point in one edit and selects it", async () => {
    const system = trappist();
    addSpecialSystem.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    mockedIpc.getSystem.mockResolvedValue({ system, neighbours: [], nebula: null });

    expect(await editor().addSpecialSystemAt(-50, -20, "trappist_initializer")).toBe(true);

    const [seed, x, y, layout] = addSpecialSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, layout]).toEqual([-50, -20, "trappist_initializer"]);
    expect(editor().selection).toEqual([6]);
    expect(editor().inspected?.system.id).toBe(6);
    expect(addRandomSystem).not.toHaveBeenCalled();
  });

  it("rolls the same layout again, and a new class rolls a regular system", async () => {
    useGalaxyStore.getState().applyDelta({ systems: [trappist()] });
    rerollSystem.mockResolvedValue(editResult());

    expect(await editor().rerollSystem(6)).toBe(true);
    expect(await editor().rerollSystem(6, "sc_g")).toBe(true);

    expect(rerollSystem.mock.calls.map(([id, , star, keep]) => [id, star, keep])).toEqual([
      [6, "sc_m", true],
      [6, "sc_g", false],
    ]);
  });

  it("reports a refused spot without asking the core", async () => {
    expect(await editor().addSpecialSystemAt(3, 0, "trappist_initializer")).toBe(false);
    expect(addSpecialSystem).not.toHaveBeenCalled();
    expect(sessionError()).toMatch(/^Too close to .+/);
  });
});

describe("why a system cannot be added", () => {
  const asIs = async () => {};

  it.each([
    ["is null on a clear spot of a loaded 4.x save", asIs, [-50, -20], null],
    [
      "names the system inside the spawn buffer",
      asIs,
      [6, 8],
      {
        limit: "tooClose",
        reason: expect.stringMatching(/^Too close to .+: \d+ away, the game needs 10$/),
      },
    ],
    [
      "names the galaxy's edge past its radius",
      asIs,
      [100, 0],
      { reason: "Outside the galaxy's edge (radius 60)", limit: "outside", radius: 60 },
    ],
    [
      "asks for game data",
      () => useGameDataStore.getState().unload(),
      [-50, -20],
      expect.objectContaining({ reason: NEEDS_GAME_DATA }),
    ],
    [
      "asks for a Stellaris 4 save",
      async () => useFileSessionStore.setState({ meta: saveMeta({ version: "Libra v3.4.5" }) }),
      [-50, -20],
      expect.objectContaining({ reason: NEEDS_STELLARIS_4 }),
    ],
    [
      "is null for an Ironman save",
      async () => useFileSessionStore.setState({ meta: saveMeta({ ironman: true }) }),
      [-50, -20],
      null,
    ],
  ] as const)("%s", async (_case, arrange, [x, y], refusal) => {
    await arrange();
    expect(addSystemRefusalAt(x, y)).toEqual(refusal);
  });
});

describe("editing a system added this session", () => {
  it("rolls it again with the class asked for", async () => {
    const [six] = withAddedSystems();
    rerollSystem.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...six, star_class: "sc_m" }] } }),
    );

    expect(await editor().rerollSystem(6, "sc_m")).toBe(true);

    const [id, seed, starClass] = rerollSystem.mock.calls[0];
    expect([id, starClass]).toEqual([6, "sc_m"]);
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(useGalaxyStore.getState().systems.get(6)?.star_class).toBe("sc_m");
  });

  it("leaves a system the file already held alone", async () => {
    expect(await editor().rerollSystem(0, null)).toBe(false);
    expect(await editor().renameAddedSystem(0, "Dorellion")).toBe(false);
    expect(rerollSystem).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("renames it with one op", async () => {
    withAddedSystems();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());

    expect(await editor().renameAddedSystem(6, "  Dorellion ")).toBe(true);

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "RenameSystem",
      system: 6,
      name: "Dorellion",
    });
  });
});
