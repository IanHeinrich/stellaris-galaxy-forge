import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { Capabilities } from "../generated/Capabilities";
import { systemDetails } from "../test/builders";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "./fixture";
import { laneCount, useGalaxyStore } from "./galaxyStore";
import { loadGameData } from "./gameDataFixture";
import { useGameDataStore } from "./gameDataStore";
import { useIssuesStore } from "./issuesStore";
import { useLGateStore } from "./lgateStore";
import { usePaintModStore } from "./paintModStore";
import { useRecentsStore } from "./recentsStore";
import { edit, listen, resetSession, session } from "./sessionFixture";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";

beforeEach(resetSession);

describe("openSave", () => {
  it("loads the galaxy, meta and issues and reports progress while loading", async () => {
    const p = session().openSave(OPEN_RESULT.path);
    await until(() => expect(listen.progress).not.toBeNull());
    expect(session().status).toBe("loading");
    listen.progress!({ phase: "read", fraction: 0.5 });
    expect(session().progress).toEqual({ phase: "read", fraction: 0.5 });
    await p;

    const state = session();
    expect(state.status).toBe("ready");
    expect(state.path).toBe(OPEN_RESULT.path);
    expect(state.meta).toEqual(OPEN_RESULT.meta);
    expect(useIssuesStore.getState().issues).toHaveLength(1);
    expect(state.progress).toBeNull();
    expect(listen.unlisten).toHaveBeenCalledTimes(1);
    expect(mockedIpc.openSave).toHaveBeenCalledWith(OPEN_RESULT.path);

    const galaxy = useGalaxyStore.getState();
    expect(galaxy.galaxy).toBe(OPEN_RESULT.galaxy);
    expect(galaxy.systems.size).toBe(6);
    expect(galaxy.grid?.nearestSystem(21, 9, 5)?.id).toBe(2);
    expect(laneCount(galaxy.systems.values())).toBe(4);
  });

  it("settles what the document supports before the galaxy store hears about it", async () => {
    let atLoad: Capabilities | null | undefined;
    const unsubscribe = useGalaxyStore.subscribe((state, previous) => {
      if (state.galaxy !== previous.galaxy) atLoad = session().capabilities;
    });
    await session().openSave(OPEN_RESULT.path);
    unsubscribe();
    expect(atLoad).toEqual(OPEN_RESULT.capabilities);
  });

  it("asks for the special systems again once the details projection is warm", async () => {
    await session().openSave(OPEN_RESULT.path);
    expect(mockedIpc.warmDetails).toHaveBeenCalledTimes(1);
    await until(() => expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(2));
  });

  it("a details projection that fails to warm says so on the session, which still opened", async () => {
    mockedIpc.warmDetails.mockRejectedValueOnce({ kind: "internal", message: "no projection" });

    expect(await session().openSave(OPEN_RESULT.path)).toBe(true);

    expect(session().status).toBe("ready");
    await until(() => expect(session().error).toBe("no projection"));
  });

  it("reports a rejection as an error and closes the session left on the Rust side", async () => {
    mockedIpc.openSave.mockRejectedValueOnce({ kind: "format", message: "not a zip" });
    mockedIpc.closeSave.mockRejectedValueOnce({ kind: "no_session", message: "nothing open" });
    await session().openSave("bad.sav");
    const state = session();
    expect(state.status).toBe("error");
    expect(state.error).toBe("not a zip");
    expect(state.errorKind).toBe("format");
    expect(mockedIpc.closeSave).toHaveBeenCalledTimes(1);
    expect(useGalaxyStore.getState().systems.size).toBe(0);
    expect(listen.unlisten).toHaveBeenCalledTimes(1);
  });

  it("a failed open forgets what the document before it left in game data and details", async () => {
    await session().openSave(OPEN_RESULT.path);
    useDetailsStore.setState({ details: new Map([[0, systemDetails()]]) });
    useGameDataStore.setState({ counts: [{ kind: "leviathan", count: 1, primary_count: 1 }] });

    mockedIpc.openSave.mockRejectedValueOnce({ kind: "format", message: "not a zip" });
    await session().openSave("bad.sav");

    expect(useDetailsStore.getState().details.size).toBe(0);
    expect(useGameDataStore.getState().counts).toEqual([]);
  });

  it("every save opens with the L-Gate outcome hidden, whatever the one before showed", async () => {
    await session().openSave(OPEN_RESULT.path);
    useLGateStore.getState().reveal();

    await session().openSave(OPEN_RESULT.path);

    expect(useLGateStore.getState().revealed).toBe(false);
  });

  it("an open forgets the selection and the history of the file before it", async () => {
    await session().openSave(OPEN_RESULT.path);
    await useEditorStore.getState().select(1);
    await edit();
    expect(useEditorStore.getState().history.undo).toHaveLength(1);

    await session().openSave(OPEN_RESULT.path);
    const editor = useEditorStore.getState();
    expect(editor.selection).toEqual([]);
    expect(editor.inspected).toBeNull();
    expect(editor.history).toEqual({ undo: [], redo: [] });
  });

  it("a save renamed to .txt opens as a save, without the Paint a Galaxy question", async () => {
    usePaintModStore.setState({ warnNotForPaint: true });
    mockedIpc.documentKind.mockResolvedValue("save");
    mockedIpc.scenarioPainted.mockResolvedValue(false);
    let asked = false;
    // The fixture answers a prompt as it is set, so a listener may only see it as `previous`.
    const unsubscribe = useFileSessionStore.subscribe((state, previous) => {
      if (state.scenarioPrompt !== null || previous.scenarioPrompt !== null) asked = true;
    });
    await session().openPath("C:/saves/renamed.txt", "save", { listings: null });
    unsubscribe();
    expect(asked).toBe(false);
    expect(mockedIpc.openSave).toHaveBeenCalledWith("C:/saves/renamed.txt");
    expect(session().kind).toBe("save");
  });

  it("a file the probe cannot read opens by its name, so a missing save shows its read error", async () => {
    usePaintModStore.setState({ warnNotForPaint: true });
    mockedIpc.documentKind.mockRejectedValue({ kind: "not_found", message: "gone.sav not found" });
    mockedIpc.openSave.mockRejectedValueOnce({ kind: "not_found", message: "gone.sav not found" });
    let asked = false;
    const unsubscribe = useFileSessionStore.subscribe((state, previous) => {
      if (state.scenarioPrompt !== null || previous.scenarioPrompt !== null) asked = true;
    });
    await session().openPath("C:/saves/gone.sav", "save", { listings: null });
    unsubscribe();
    expect(asked).toBe(false);
    expect(mockedIpc.openSave).toHaveBeenCalledWith("C:/saves/gone.sav");
    expect(session().error).toBe("gone.sav not found");

    await session().requestOpen("C:/saves/gone.sav", { listings: null });
    expect(session().pendingOpen).toBe("C:/saves/gone.sav");
  });

  it("pickAndOpen asks how to open the picked save and does nothing when cancelled", async () => {
    mockedIpc.saveDirs.mockResolvedValue(["C:/saves"]);
    mockedIpc.open.mockResolvedValueOnce(null);
    await session().pickAndOpen(undefined, undefined, null);
    expect(mockedIpc.openSave).not.toHaveBeenCalled();
    expect(mockedIpc.confirm).not.toHaveBeenCalled();

    mockedIpc.open.mockResolvedValueOnce("C:/saves/picked.sav");
    await session().pickAndOpen(undefined, undefined, null);
    expect(mockedIpc.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:/saves",
        multiple: false,
        filters: [
          { name: "All supported", extensions: ["sav", "txt"] },
          { name: "Stellaris save", extensions: ["sav"] },
          { name: "Stellaris static galaxy scenario", extensions: ["txt"] },
        ],
      }),
    );
    expect(mockedIpc.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBe("C:/saves/picked.sav");

    await session().chooseOpenMode("save");
    expect(mockedIpc.openSave).toHaveBeenCalledWith("C:/saves/picked.sav");
    expect(session().pendingOpen).toBeNull();
    expect(session().status).toBe("ready");
  });

  it("pickAndOpen with mode 'scenario' filters to .sav and skips the mode dialog", async () => {
    mockedIpc.saveDirs.mockResolvedValue(["C:/saves"]);
    mockedIpc.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    usePaintModStore.getState().setPaintChoice(false);
    mockedIpc.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario");

    expect(mockedIpc.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:/saves",
        multiple: false,
        filters: [{ name: "Stellaris save", extensions: ["sav"] }],
      }),
    );
    expect(mockedIpc.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "plain");
    expect(mockedIpc.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBeNull();
  });

  it("a save taken as a scenario follows the standing Paint a Galaxy choice on every route", async () => {
    mockedIpc.saveDirs.mockResolvedValue(["C:/saves"]);
    mockedIpc.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    usePaintModStore.getState().setPaintChoice(true);

    mockedIpc.open.mockResolvedValueOnce("C:/saves/picked.sav");
    await session().pickAndOpen("scenario");
    expect(mockedIpc.openAsScenario).toHaveBeenLastCalledWith(
      "C:/saves/picked.sav",
      "paint_a_galaxy",
    );

    mockedIpc.open.mockResolvedValueOnce("C:/saves/other.sav");
    await session().pickAndOpen(undefined, undefined, null);
    await session().chooseOpenMode("scenario");
    expect(mockedIpc.openAsScenario).toHaveBeenLastCalledWith(
      "C:/saves/other.sav",
      "paint_a_galaxy",
    );

    usePaintModStore.getState().setPaintChoice(false);
    mockedIpc.open.mockResolvedValueOnce("C:/saves/plain.sav");
    await session().pickAndOpen(undefined, undefined, null);
    await session().chooseOpenMode("scenario");
    expect(mockedIpc.openAsScenario).toHaveBeenLastCalledWith("C:/saves/plain.sav", "plain");

    await session().requestOpen("C:/saves/taken.sav", { asScenario: true, listings: null });
    expect(session().pendingAsScenario).toBe(true);
    await session().chooseOpenMode("scenario");
    expect(mockedIpc.openAsScenario).toHaveBeenLastCalledWith("C:/saves/taken.sav", "plain");
    expect(session().pendingAsScenario).toBe(false);
  });

  it("pickAndOpen with a profile opens the picked save as a scenario written under it", async () => {
    mockedIpc.saveDirs.mockResolvedValue(["C:/saves"]);
    mockedIpc.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null, painted: true });
    mockedIpc.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario", "paint_a_galaxy");

    expect(mockedIpc.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "paint_a_galaxy");
    expect(session().painted).toBe(true);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);
  });

  it("pickAndOpen with an explicit plain profile opens plain even while the standing choice is on", async () => {
    mockedIpc.saveDirs.mockResolvedValue(["C:/saves"]);
    mockedIpc.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
    usePaintModStore.getState().setPaintChoice(true);
    mockedIpc.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario", "plain");

    expect(mockedIpc.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "plain");
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);

    mockedIpc.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "plain");
    expect(mockedIpc.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "plain");
    expect(getPaintLayer()).toBe(false);
  });
});

describe("reload", () => {
  it("re-reads the open file, and a refused discard leaves the session alone", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();
    expect(session().dirty).toBe(true);

    mockedIpc.confirm.mockResolvedValueOnce(false);
    await session().reload();
    expect(mockedIpc.openSave).toHaveBeenCalledTimes(1);
    expect(session().dirty).toBe(true);

    await session().reload();
    expect(mockedIpc.openSave).toHaveBeenLastCalledWith(OPEN_RESULT.path);
    expect(session().dirty).toBe(false);
  });
});

describe("close", () => {
  beforeEach(async () => {
    await session().openSave(OPEN_RESULT.path);
  });

  it.each([
    ["clean, drops the session and the galaxy", null, true],
    ["dirty with the discard declined, leaves the session open", false, false],
    ["dirty with the discard confirmed, closes", true, true],
  ])("%s", async (_case, discard, closed) => {
    if (discard !== null) {
      await edit();
      mockedIpc.confirm.mockResolvedValueOnce(discard);
    }
    await session().close();

    expect(mockedIpc.confirm).toHaveBeenCalledTimes(discard === null ? 0 : 1);
    expect(mockedIpc.closeSave).toHaveBeenCalledTimes(closed ? 1 : 0);
    expect(session().status).toBe(closed ? "empty" : "ready");
    expect(useGalaxyStore.getState().galaxy === null).toBe(closed);
  });
});

describe("recents", () => {
  it("opening a save records a recent with the save's subtitle", async () => {
    await session().openSave(OPEN_RESULT.path);
    const recents = useRecentsStore.getState().recents;
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({
      kind: "save",
      path: OPEN_RESULT.path,
      title: OPEN_RESULT.title,
      subtitle: "Test Empire · 2206.11.16 · v4.4.6",
    });
  });

  it("a new scenario and a save opened as a scenario have no path, so nothing is recorded", async () => {
    mockedIpc.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(useRecentsStore.getState().recents).toHaveLength(0);

    mockedIpc.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().openScenarioFrom(OPEN_RESULT.path);
    expect(useRecentsStore.getState().recents).toHaveLength(0);
  });
});

describe("settling", () => {
  it("a scenario open with game data ready holds settling until the owners pass resolves", async () => {
    await loadGameData();
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    let resolveOwners!: (owners: null) => void;
    mockedIpc.getScenarioOwners.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOwners = resolve)),
    );

    const opening = session().openSave(SCENARIO_RESULT.path);
    await until(() => expect(session().settling).toBe(true));
    expect(session().status).toBe("ready");
    expect(session().loadingName).toBe("my_galaxy.txt");

    resolveOwners(null);
    await opening;
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });

  it("a save open never sets settling", async () => {
    await loadGameData();
    await session().openSave(OPEN_RESULT.path);
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });

  it("a scenario open before game data is ready never sets settling", async () => {
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_RESULT.path);
    expect(session().settling).toBe(false);
  });

  it("a failing owners pass still clears settling", async () => {
    await loadGameData();
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    mockedIpc.getScenarioOwners.mockRejectedValueOnce({ kind: "ipc", message: "boom" });

    await session().openSave(SCENARIO_RESULT.path);
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });
});

describe("game data changing under an open scenario", () => {
  it("redraws each system with the star its initializer now names", async () => {
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_RESULT.path!);
    const [first] = SCENARIO_RESULT.galaxy.systems;
    mockedIpc.getGalaxy.mockResolvedValueOnce({
      ...SCENARIO_RESULT.galaxy,
      systems: [{ ...first, star_class: "sc_pulsar" }],
    });

    useGameDataStore.setState({ version: useGameDataStore.getState().version + 1 });

    await until(() =>
      expect(useGalaxyStore.getState().systems.get(first.id)?.star_class).toBe("sc_pulsar"),
    );
  });
});
