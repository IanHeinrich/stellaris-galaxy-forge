import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { Capabilities } from "../generated/Capabilities";
import { systemDetails } from "../test/builders";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { getPaintLayer } from "./fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "./fixture";
import { laneCount, useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useIssuesStore } from "./issuesStore";
import { usePaintModStore } from "./paintModStore";
import { useRecentsStore } from "./recentsStore";
import { edit, listen, mocked, resetSession, session } from "./sessionFixture";

beforeEach(resetSession);

describe("openSave", () => {
  it("loads the galaxy, meta and issues and reports progress while loading", async () => {
    const p = session().openSave(OPEN_RESULT.path);
    await vi.waitFor(() => expect(listen.progress).not.toBeNull());
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
    expect(mocked.openSave).toHaveBeenCalledWith(OPEN_RESULT.path);

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
    expect(mocked.warmDetails).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(2));
  });

  it("a details projection that fails to warm says so on the session, which still opened", async () => {
    mocked.warmDetails.mockRejectedValueOnce({ kind: "internal", message: "no projection" });

    expect(await session().openSave(OPEN_RESULT.path)).toBe(true);

    expect(session().status).toBe("ready");
    await vi.waitFor(() => expect(session().error).toBe("no projection"));
  });

  it("reports a rejection as an error and closes the session left on the Rust side", async () => {
    mocked.openSave.mockRejectedValueOnce({ kind: "format", message: "not a zip" });
    mocked.closeSave.mockRejectedValueOnce({ kind: "no_session", message: "nothing open" });
    await session().openSave("bad.sav");
    const state = session();
    expect(state.status).toBe("error");
    expect(state.error).toBe("not a zip");
    expect(state.errorKind).toBe("format");
    expect(mocked.closeSave).toHaveBeenCalledTimes(1);
    expect(useGalaxyStore.getState().systems.size).toBe(0);
    expect(listen.unlisten).toHaveBeenCalledTimes(1);
  });

  it("a failed open forgets what the document before it left in game data and details", async () => {
    await session().openSave(OPEN_RESULT.path);
    useDetailsStore.setState({ details: new Map([[0, systemDetails()]]) });
    useGameDataStore.setState({ counts: [{ kind: "leviathan", count: 1, primary_count: 1 }] });

    mocked.openSave.mockRejectedValueOnce({ kind: "format", message: "not a zip" });
    await session().openSave("bad.sav");

    expect(useDetailsStore.getState().details.size).toBe(0);
    expect(useGameDataStore.getState().counts).toEqual([]);
  });

  it("reports a missing file with the not_found kind", async () => {
    mocked.openSave.mockRejectedValueOnce({ kind: "not_found", message: "no such file" });
    await session().openSave("gone.sav");
    const state = session();
    expect(state.error).toBe("no such file");
    expect(state.errorKind).toBe("not_found");
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

  it("pickAndOpen asks how to open the picked save and does nothing when cancelled", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.open.mockResolvedValueOnce(null);
    await session().pickAndOpen(undefined, undefined, null);
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(mocked.confirm).not.toHaveBeenCalled();

    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");
    await session().pickAndOpen(undefined, undefined, null);
    expect(mocked.open).toHaveBeenCalledWith(
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
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBe("C:/saves/picked.sav");

    await session().chooseOpenMode("save");
    expect(mocked.openSave).toHaveBeenCalledWith("C:/saves/picked.sav");
    expect(session().pendingOpen).toBeNull();
    expect(session().status).toBe("ready");
  });

  it("pickAndOpen with mode 'scenario' filters to .sav and skips the mode dialog", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    usePaintModStore.setState({ paintChoice: false });
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario");

    expect(mocked.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:/saves",
        multiple: false,
        filters: [{ name: "Stellaris save", extensions: ["sav"] }],
      }),
    );
    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "plain");
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBeNull();
  });

  it("a save taken as a scenario follows the standing Paint a Galaxy choice on every route", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    usePaintModStore.setState({ paintChoice: true });

    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");
    await session().pickAndOpen("scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/picked.sav", "paint_a_galaxy");

    mocked.open.mockResolvedValueOnce("C:/saves/other.sav");
    await session().pickAndOpen(undefined, undefined, null);
    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/other.sav", "paint_a_galaxy");

    usePaintModStore.setState({ paintChoice: false });
    mocked.open.mockResolvedValueOnce("C:/saves/plain.sav");
    await session().pickAndOpen(undefined, undefined, null);
    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/plain.sav", "plain");
  });

  it("pickAndOpen with a profile opens the picked save as a scenario written under it", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null, painted: true });
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario", "paint_a_galaxy");

    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "paint_a_galaxy");
    expect(session().painted).toBe(true);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);
  });

  it("pickAndOpen with an explicit plain profile opens plain even while the standing choice is on", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
    usePaintModStore.setState({ paintChoice: true });
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario", "plain");

    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "plain");
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);

    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "plain");
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "plain");
    expect(getPaintLayer()).toBe(false);
  });
});

describe("reload", () => {
  it("re-reads the open file, and a refused discard leaves the session alone", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();
    expect(session().dirty).toBe(true);

    mocked.confirm.mockResolvedValueOnce(false);
    await session().reload();
    expect(mocked.openSave).toHaveBeenCalledTimes(1);
    expect(session().dirty).toBe(true);

    await session().reload();
    expect(mocked.openSave).toHaveBeenLastCalledWith(OPEN_RESULT.path);
    expect(session().dirty).toBe(false);
  });
});

describe("close", () => {
  beforeEach(async () => {
    await session().openSave(OPEN_RESULT.path);
  });

  it("drops the session and the galaxy", async () => {
    await session().close();
    expect(mocked.closeSave).toHaveBeenCalledTimes(1);
    expect(session().status).toBe("empty");
    expect(useGalaxyStore.getState().galaxy).toBeNull();
  });

  it("when dirty and confirm -> false leaves the session open and calls no closeSave", async () => {
    await edit();
    mocked.confirm.mockResolvedValueOnce(false);
    await session().close();

    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.closeSave).not.toHaveBeenCalled();
    expect(session().status).toBe("ready");
  });

  it("when dirty and confirm -> true closes", async () => {
    await edit();
    mocked.confirm.mockResolvedValueOnce(true);
    await session().close();

    expect(mocked.closeSave).toHaveBeenCalledTimes(1);
    expect(session().status).toBe("empty");
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
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(useRecentsStore.getState().recents).toHaveLength(0);

    mocked.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().openScenarioFrom(OPEN_RESULT.path);
    expect(useRecentsStore.getState().recents).toHaveLength(0);
  });
});

describe("settling", () => {
  it("a scenario open with game data ready holds settling until the owners pass resolves", async () => {
    useGameDataStore.setState({ status: "ready" });
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    let resolveOwners!: (owners: null) => void;
    mocked.getScenarioOwners.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOwners = resolve)),
    );

    const opening = session().openSave(SCENARIO_RESULT.path);
    await vi.waitFor(() => expect(session().settling).toBe(true));
    expect(session().status).toBe("ready");
    expect(session().loadingName).toBe("my_galaxy.txt");

    resolveOwners(null);
    await opening;
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });

  it("a save open never sets settling", async () => {
    useGameDataStore.setState({ status: "ready" });
    await session().openSave(OPEN_RESULT.path);
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });

  it("a scenario open before game data is ready never sets settling", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_RESULT.path);
    expect(session().settling).toBe(false);
  });

  it("a failing owners pass still clears settling", async () => {
    useGameDataStore.setState({ status: "ready" });
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    mocked.getScenarioOwners.mockRejectedValueOnce({ kind: "ipc", message: "boom" });

    await session().openSave(SCENARIO_RESULT.path);
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });
});
