import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { paintModView } from "../test/builders";
import { getPaintLayer } from "./fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT, saveResult } from "./fixture";
import { usePaintModStore } from "./paintModStore";
import { mocked, resetSession, session, withPaintMod } from "./sessionFixture";

beforeEach(resetSession);

describe("scenario documents", () => {
  const SCENARIO_PATH = SCENARIO_RESULT.path;
  const PAINT_DIR = "C:/mods/pag/map/setup_scenarios";
  /** The scenario fixture with a header that names its size Elysium. */
  const ELYSIUM = {
    ...SCENARIO_RESULT,
    galaxy: { ...SCENARIO_RESULT.galaxy, header: [{ key: "name", value: '"Elysium"', line: 1 }] },
  };

  it("opening a scenario file takes its kind, title and capabilities, and has no save header", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH, { listings: null });

    const state = session();
    expect(mocked.openSave).toHaveBeenCalledWith(SCENARIO_PATH);
    expect(state.pendingOpen).toBeNull();
    expect(state.status).toBe("ready");
    expect(state.kind).toBe("scenario");
    expect(state.title).toBe("my_galaxy");
    expect(state.meta).toBeNull();
    expect(state.capabilities).toEqual(SCENARIO_RESULT.capabilities);
    expect(state.path).toBe(SCENARIO_PATH);
  });

  it("a save asks first: as a scenario, as a save, or not at all", async () => {
    usePaintModStore.getState().setPaintChoice(false);
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
    await session().requestOpen(OPEN_RESULT.path, { listings: null });
    expect(session().pendingOpen).toBe(OPEN_RESULT.path);
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(mocked.openAsScenario).not.toHaveBeenCalled();

    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenCalledWith(OPEN_RESULT.path, "plain");
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().kind).toBe("scenario");
    expect(session().path).toBeNull();

    await session().requestOpen(OPEN_RESULT.path, { listings: null });
    await session().chooseOpenMode("save");
    expect(mocked.openSave).toHaveBeenCalledWith(OPEN_RESULT.path);
    expect(session().kind).toBe("save");

    await session().requestOpen(OPEN_RESULT.path, { listings: null });
    await session().chooseOpenMode(null);
    expect(session().pendingOpen).toBeNull();
    expect(mocked.openSave).toHaveBeenCalledTimes(1);
    expect(mocked.openAsScenario).toHaveBeenCalledTimes(1);
  });

  it("a new scenario has no path, so Save asks where to put it", async () => {
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "plain");
    expect(session().path).toBeNull();
    expect(session().title).toBe("my_galaxy");
    expect(getPaintLayer()).toBe(false);

    mocked.saveDialog.mockResolvedValueOnce("C:/mods/map/setup_scenarios/my_galaxy.txt");
    mocked.saveAs.mockResolvedValueOnce(
      saveResult({ path: "C:/mods/map/setup_scenarios/my_galaxy.txt" }),
    );
    await session().save();

    expect(mocked.save).not.toHaveBeenCalled();
    expect(mocked.saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "my_galaxy.txt",
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mocked.saveAs).toHaveBeenCalledWith("C:/mods/map/setup_scenarios/my_galaxy.txt");
    expect(session().path).toBe("C:/mods/map/setup_scenarios/my_galaxy.txt");
  });

  it("a new scenario under the Paint a Galaxy profile asks for it and turns the layer on", async () => {
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "paint_a_galaxy");
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "paint_a_galaxy");
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);

    mocked.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().openScenarioFrom(OPEN_RESULT.path, "paint_a_galaxy");
    expect(mocked.openAsScenario).toHaveBeenCalledWith(OPEN_RESULT.path, "paint_a_galaxy");
    expect(getPaintLayer()).toBe(true);

    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);
  });

  it("a painted file turns the layer on without a profile; a plain open turns it off again", async () => {
    mocked.openSave.mockResolvedValueOnce({ ...SCENARIO_RESULT, painted: true });
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    expect(session().painted).toBe(true);
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(true);

    await session().close();
    expect(session().painted).toBe(false);
    expect(getPaintLayer()).toBe(false);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    expect(getPaintLayer()).toBe(false);
  });

  it("a scenario opened for Paint a Galaxy is on the layer though its bytes say nothing of the mod", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_PATH, "paint_a_galaxy");
    expect(mocked.openSave).toHaveBeenCalledWith(SCENARIO_PATH);
    expect(session().painted).toBe(false);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_PATH);
    expect(session().paintChosen).toBe(false);
  });

  it("reloading keeps what was said of the file at open, since the bytes cannot say it", async () => {
    mocked.openSave.mockResolvedValue(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_PATH, "paint_a_galaxy");
    expect(getPaintLayer()).toBe(true);

    await session().reload();
    expect(mocked.openSave).toHaveBeenCalledTimes(2);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);

    await session().openScenario(SCENARIO_PATH);
    await session().reload();
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);
    mocked.openSave.mockResolvedValue(OPEN_RESULT);
  });

  it("a plain scenario inside the mod's scenarios folder is on the layer; the same file elsewhere is not", async () => {
    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));
    mocked.openSave.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: `${PAINT_DIR}/mine.txt` });
    await session().requestOpen(`${PAINT_DIR}/mine.txt`, { listings: null });
    expect(getPaintLayer()).toBe(true);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    expect(getPaintLayer()).toBe(false);

    mocked.openSave.mockResolvedValueOnce({ ...OPEN_RESULT, path: `${PAINT_DIR}/mine.sav` });
    await session().openSave(`${PAINT_DIR}/mine.sav`);
    expect(getPaintLayer()).toBe(false);
  });

  it("a new scenario on the layer is offered the mod's scenarios folder; an existing file keeps its path", async () => {
    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "paint_a_galaxy");

    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: `${PAINT_DIR}/my_galaxy.txt` }),
    );

    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: "my_galaxy.txt" }),
    );

    mocked.openSave.mockResolvedValueOnce({ ...SCENARIO_RESULT, painted: true });
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: SCENARIO_PATH }),
    );
  });

  it("saving into the mod offers its folder under the file's own name, and does nothing without one", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    await session().saveIntoPaintMod();
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    await withPaintMod(
      paintModView({
        scenarios_dir: "C:\\mods\\pag\\map\\setup_scenarios",
        enabled: false,
      }),
    );
    const landed = "C:\\mods\\pag\\map\\setup_scenarios\\my_galaxy.txt";
    mocked.saveDialog.mockResolvedValueOnce(landed);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: landed }));
    await session().saveIntoPaintMod();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultPath: landed,
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mocked.saveAs).toHaveBeenCalledWith(landed);
    expect(session().path).toBe(landed);
    expect(getPaintLayer()).toBe(true);

    await session().openSave(OPEN_RESULT.path);
    await session().saveIntoPaintMod();
    expect(mocked.saveDialog).toHaveBeenCalledTimes(1);
  });

  it("says what to do next once a file lands in the mod's folder, named by the header's size", async () => {
    mocked.openSave.mockResolvedValueOnce(ELYSIUM);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));

    const landed = `${PAINT_DIR}/my_galaxy.txt`;
    mocked.saveDialog.mockResolvedValueOnce(landed);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: landed }));
    await session().saveIntoPaintMod();

    expect(session().notice).toBe(
      "Saved into the Paint a Galaxy mod. In Stellaris, start a new game and pick the size Elysium.",
    );
  });

  it("says nothing next when the header names no size, or the file lands outside the mod's folder", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));

    mocked.saveDialog.mockResolvedValueOnce(`${PAINT_DIR}/my_galaxy.txt`);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: `${PAINT_DIR}/my_galaxy.txt` }));
    await session().saveIntoPaintMod();
    expect(session().notice).toBeNull();

    mocked.openSave.mockResolvedValueOnce(ELYSIUM);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    mocked.saveDialog.mockResolvedValueOnce("C:/mods/mine/map/setup_scenarios/elsewhere.txt");
    mocked.saveAs.mockResolvedValueOnce(
      saveResult({ path: "C:/mods/mine/map/setup_scenarios/elsewhere.txt" }),
    );
    await session().saveAs();
    expect(session().notice).toBeNull();
  });
});
