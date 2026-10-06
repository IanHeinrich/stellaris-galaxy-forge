import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { ExportReport } from "../generated/ExportReport";
import { paintModView } from "../test/builders";
import { getPaintLayer } from "./fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT, exportReport, saveResult } from "./fixture";
import { edit, resetSession, session, withPaintMod } from "./sessionFixture";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";
import { usePaintModStore } from "./paintModStore";

beforeEach(resetSession);

describe("exporting a save as a scenario", () => {
  const SCENARIO_PATH = SCENARIO_RESULT.path;
  const PAINT_DIR = "C:/mods/pag/map/setup_scenarios";

  /** Asks for the export, which previews what it carries over and waits for the answer. */
  async function preview(): Promise<void> {
    mockedIpc.previewExport.mockResolvedValueOnce(exportReport());
    await session().exportScenario();
  }

  it("previews what the chosen profile writes, and previews again when the choice changes", async () => {
    await session().openSave(OPEN_RESULT.path);
    usePaintModStore.setState({ paintChoice: false });
    const plain = exportReport({ seats: 17 });
    mockedIpc.previewExport.mockResolvedValueOnce(plain);
    await session().exportScenario();
    expect(mockedIpc.previewExport).toHaveBeenLastCalledWith("plain");
    expect(session().pendingExport).toEqual(plain);

    const painted = exportReport({ seats: 17, player_seat: 217, player_seat_kind: "sol" });
    mockedIpc.previewExport.mockResolvedValueOnce(painted);
    usePaintModStore.setState({ paintChoice: true });
    await until(() => expect(session().pendingExport).toBe(painted));
    expect(mockedIpc.previewExport).toHaveBeenLastCalledWith("paint_a_galaxy");

    expect(session().pendingExportProfile).toBe("paint_a_galaxy");

    await session().confirmExport(null);
    mockedIpc.previewExport.mockClear();
    usePaintModStore.setState({ paintChoice: false });
    expect(mockedIpc.previewExport).not.toHaveBeenCalled();
  });

  it("drops a preview read again for a new profile when the export is answered before it lands", async () => {
    await session().openSave(OPEN_RESULT.path);
    usePaintModStore.setState({ paintChoice: false });
    mockedIpc.previewExport.mockResolvedValueOnce(exportReport());
    await session().exportScenario();

    let land: (report: ExportReport) => void = () => {};
    mockedIpc.previewExport.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    usePaintModStore.setState({ paintChoice: true });
    await session().confirmExport(null);
    land(exportReport({ player_seat: 217 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(session().pendingExport).toBeNull();
    expect(session().pendingExportProfile).toBeNull();
  });

  it("exporting previews the report, then writes a second file and leaves the save's own path, edits and save time alone", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();

    const report = exportReport({ dropped: { wormhole_pairs: 6, gateways: 0, lgates: 0 } });
    mockedIpc.previewExport.mockResolvedValueOnce(report);
    await session().exportScenario();
    expect(session().pendingExport).toEqual(report);
    expect(mockedIpc.saveDialog).not.toHaveBeenCalled();

    const exported = "C:/mods/map/setup_scenarios/test_empire.txt";
    mockedIpc.saveDialog.mockResolvedValueOnce(exported);
    const save = saveResult({ path: exported, dirty: true });
    mockedIpc.exportScenario.mockResolvedValueOnce({ save, report });
    const before = Date.now();
    await session().confirmExport("plain");

    expect(mockedIpc.saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "Test Empire.txt",
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mockedIpc.exportScenario).toHaveBeenCalledWith(exported, "plain");
    const state = session();
    expect(state.pendingExport).toBeNull();
    expect(state.path).toBe(OPEN_RESULT.path);
    expect(state.dirty).toBe(true);
    expect(state.saving).toBe(false);
    expect(state.lastSave).toBeNull();
    expect(state.lastExport).toEqual({ save, report });
    expect(state.exportedAt).toBeGreaterThanOrEqual(before);
    expect(state.savedAt).toBeNull();

    await session().openSave(OPEN_RESULT.path);
    expect(session().lastExport).toBeNull();
    expect(session().exportedAt).toBeNull();
  });

  it("exporting for Paint a Galaxy asks for that profile, and offers the mod's folder when known", async () => {
    await session().openSave(OPEN_RESULT.path);
    await preview();
    const exported = "C:/mods/map/setup_scenarios/test_empire.txt";
    mockedIpc.saveDialog.mockResolvedValueOnce(exported);
    mockedIpc.exportScenario.mockResolvedValueOnce({
      save: saveResult({ path: exported }),
      report: exportReport(),
    });

    await session().confirmExport("paint_a_galaxy");

    expect(mockedIpc.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: "Test Empire.txt" }),
    );
    expect(mockedIpc.exportScenario).toHaveBeenCalledWith(exported, "paint_a_galaxy");
    expect(getPaintLayer()).toBe(false);

    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));
    await preview();
    mockedIpc.saveDialog.mockResolvedValueOnce(null);
    await session().confirmExport("paint_a_galaxy");
    expect(mockedIpc.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: `${PAINT_DIR}/Test Empire.txt` }),
    );

    await preview();
    mockedIpc.saveDialog.mockResolvedValueOnce(null);
    await session().confirmExport("plain");
    expect(mockedIpc.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: "Test Empire.txt" }),
    );
  });

  it("a cancelled export writes nothing, and a scenario has nothing to export", async () => {
    await session().openSave(OPEN_RESULT.path);
    mockedIpc.previewExport.mockResolvedValueOnce(exportReport());
    await session().exportScenario();
    await session().confirmExport(null);
    let state = session();
    expect(state.pendingExport).toBeNull();
    expect(state.saving).toBe(false);
    expect(state.lastExport).toBeNull();
    expect(mockedIpc.saveDialog).not.toHaveBeenCalled();

    mockedIpc.previewExport.mockResolvedValueOnce(exportReport());
    await session().exportScenario();
    mockedIpc.saveDialog.mockResolvedValueOnce(null);
    await session().confirmExport("plain");
    state = session();
    expect(mockedIpc.saveDialog).toHaveBeenCalledTimes(1);
    expect(mockedIpc.exportScenario).not.toHaveBeenCalled();
    expect(state.pendingExport).toBeNull();
    expect(state.saving).toBe(false);
    expect(state.lastExport).toBeNull();

    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_PATH);
    await session().exportScenario();
    expect(mockedIpc.previewExport).toHaveBeenCalledTimes(2);
    expect(session().pendingExport).toBeNull();
  });

  it("confirming with nothing pending is a no-op", async () => {
    await session().openSave(OPEN_RESULT.path);
    await session().confirmExport("plain");
    const state = session();
    expect(mockedIpc.saveDialog).not.toHaveBeenCalled();
    expect(state.saving).toBe(false);
    expect(state.lastExport).toBeNull();
    expect(state.pendingExport).toBeNull();
  });

  it("a preview that lands after another document opened raises no dialog", async () => {
    await session().openSave(OPEN_RESULT.path);
    let land!: (report: ExportReport) => void;
    mockedIpc.previewExport.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const previewing = session().exportScenario();
    await session().openSave(OPEN_RESULT.path);
    land(exportReport());
    await previewing;
    expect(session().pendingExport).toBeNull();
    expect(session().status).toBe("ready");
  });

  it("a preview that fails reports the message and asks nothing", async () => {
    await session().openSave(OPEN_RESULT.path);
    mockedIpc.previewExport.mockRejectedValueOnce({ kind: "op", message: "no galaxy" });
    await session().exportScenario();
    expect(session().pendingExport).toBeNull();
    expect(session().error).toBe("no galaxy");
    expect(session().errorKind).toBe("op");
  });
});
