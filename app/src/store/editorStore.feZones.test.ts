import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { EditResult } from "../generated/EditResult";
import type { FeZone } from "../generated/FeZone";
import { NO_FREE_DIRECTION, newFeZone } from "../lib/feZone";
import { editor, openFixtureSave, sessionError } from "./editorFixture";
import { NEEDS_A_SYSTEM, NOTHING_TO_FIT } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { SYSTEMS, editResult } from "./fixture";
import { mockedIpc } from "../test/ipc";

const feZoneFit = mockedIpc.feZoneFit;
const feZoneCandidateCount = mockedIpc.feZoneCandidateCount;

/** Puts `zone` on the fixture system `id`, as the galaxy the store reads. */
function anchor(id: number, zone: FeZone | null): void {
  useGalaxyStore.getState().applyDelta({ systems: [{ ...SYSTEMS[id], fe_zone: zone }] });
}

/** Arms the next op to answer with the zone written onto system `id`. */
function answersWith(id: number, zone: FeZone | null): void {
  mockedIpc.applyOp.mockResolvedValueOnce(
    editResult({ delta: { systems: [{ ...SYSTEMS[id], fe_zone: zone }] } }),
  );
}

beforeEach(async () => {
  await openFixtureSave();
  useMapChromeStore.setState({
    layers: { ...useMapChromeStore.getState().layers, feZones: false },
  });
});

describe("fallen empire zones", () => {
  it("setFeZone sends the zone as given, and null to remove it", async () => {
    const zone = { ...newFeZone("n"), kind: "hive" as const };
    answersWith(3, zone);
    expect(await editor().setFeZone(3, zone)).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "SetFeZone", id: 3, zone });
    expect(useGalaxyStore.getState().systems.get(3)?.fe_zone).toEqual(zone);

    answersWith(3, null);
    await editor().setFeZone(3, null);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({ type: "SetFeZone", id: 3, zone: null });
  });

  it("addFeZone writes a random zone in the first clear direction at 40, shows the rings and selects the anchor", async () => {
    // Sirius (30, 0): rings east and south-east at 40 cover Sol or Barnard; south is the first clear one.
    answersWith(3, newFeZone("s"));
    expect(await editor().addFeZone(3)).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetFeZone",
      id: 3,
      zone: { direction: "s", kind: "random", distance: 40, preferred: true, fallback: false },
    });
    expect(useMapChromeStore.getState().layers.feZones).toBe(true);
    expect(editor().selection).toEqual([3]);
  });

  it("addFeZone refuses an anchor with no clear direction before sending anything", async () => {
    const ring = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => ({
      ...SYSTEMS[0],
      id: 100 + i,
      x: -40 + 40 * Math.cos((deg * Math.PI) / 180),
      y: 40 + 40 * Math.sin((deg * Math.PI) / 180),
    }));
    useGalaxyStore.getState().applyDelta({ systems: ring });

    expect(await editor().addFeZone(5)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe(NO_FREE_DIRECTION);
    expect(useMapChromeStore.getState().layers.feZones).toBe(false);
  });

  it("addFeZoneAt on a galaxy with no systems says to add one first", async () => {
    useGalaxyStore.setState({ systems: new Map() });
    expect(await editor().addFeZoneAt({ x: 10, y: 10 })).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe(NEEDS_A_SYSTEM);
  });

  it("addFeZoneAt anchors the nearest system and snaps the ring to the mod's grid", async () => {
    // Nearest to (-40, 100) is Deneb (-40, 40); the point is 60 south of it.
    answersWith(5, newFeZone("s", 60));
    expect(await editor().addFeZoneAt({ x: -38, y: 102 })).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetFeZone",
      id: 5,
      zone: { direction: "s", kind: "random", distance: 60, preferred: true, fallback: false },
    });
    expect(editor().selection).toEqual([5]);
  });

  it("addFeZoneAt keeps the kind of a zone the anchor already has, and makes it the user's", async () => {
    anchor(5, { ...newFeZone("n"), kind: "machine", preferred: false, fallback: true });
    answersWith(5, newFeZone("s", 60));
    await editor().addFeZoneAt({ x: -40, y: 100 });
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetFeZone",
      id: 5,
      zone: { direction: "s", kind: "machine", distance: 60, preferred: true, fallback: true },
    });
  });

  it("addFeZoneAt refuses a ring that would cover a system, naming it, before sending anything", async () => {
    // Nearest to (28, 0) is Sirius; the ring snaps east at 30, centred on (0, 0), which is Sol.
    expect(await editor().addFeZoneAt({ x: 28, y: 0 })).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe(
      "The ring would cover Sol. A fallen empire zone must be empty space.",
    );
  });

  it("moveFeZone keeps the zone's kind and fallback and makes it the user's own", async () => {
    anchor(3, { ...newFeZone("n"), kind: "xenophobe", preferred: false, fallback: true });
    answersWith(3, newFeZone("w", 80));
    expect(await editor().moveFeZone(3, "w", 80)).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetFeZone",
      id: 3,
      zone: { direction: "w", kind: "xenophobe", distance: 80, preferred: true, fallback: true },
    });

    expect(await editor().moveFeZone(4, "w", 80)).toBe(false);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  });

  it("a refused SetFeZone leaves the reason on the session, the way a refused nebula move does", async () => {
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "ring covers Sol" });
    expect(await editor().setFeZone(3, newFeZone("e"))).toBe(false);
    expect(sessionError()).toBe("ring covers Sol");
  });

  it("fitFeZones applies what the backend answers as one SetFeZones under the fit's name, and shows the rings", async () => {
    const entries: Array<[number, FeZone | null]> = [
      [3, { ...newFeZone("n"), preferred: false }],
      [5, null],
    ];
    feZoneFit.mockResolvedValueOnce(entries);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());

    await editor().fitFeZones(2);

    expect(feZoneFit).toHaveBeenCalledWith(2);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Recompute automatic fallen empire zones",
      ops: [{ type: "SetFeZones", entries }],
    });
    expect(useMapChromeStore.getState().layers.feZones).toBe(true);
  });

  it("fitFeZones sends nothing when there is nothing to change, and says so", async () => {
    feZoneFit.mockResolvedValueOnce([]);

    await editor().fitFeZones(1);

    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe(NOTHING_TO_FIT);
    expect(useMapChromeStore.getState().layers.feZones).toBe(false);
  });

  it("fitFeZones reads the fit only once the edits queued before it have landed", async () => {
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const removing = editor().applyOp({ type: "RemoveSystem", id: 5 });
    const entries: Array<[number, FeZone | null]> = [[3, null]];
    feZoneFit.mockResolvedValueOnce(entries);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());

    const fitting = editor().fitFeZones(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(feZoneFit).not.toHaveBeenCalled();

    land(editResult({ delta: { systems: [], removed: [5] } }));
    await Promise.all([removing, fitting]);
    expect(feZoneFit).toHaveBeenCalledWith(1);
    expect(mockedIpc.applyOp.mock.calls.map(([op]) => op.type)).toEqual(["RemoveSystem", "Batch"]);
  });

  it("fitFeZones reports a backend that refused to answer", async () => {
    feZoneFit.mockRejectedValueOnce({ kind: "op", message: "not a scenario" });

    await editor().fitFeZones(1);

    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(sessionError()).toBe("not a scenario");
  });

  it("promptFeZoneFit asks over the mod's candidates and the automatic zones standing, and the fit clears it", async () => {
    anchor(3, { ...newFeZone("n"), preferred: false });
    anchor(4, { ...newFeZone("e"), preferred: false });
    anchor(5, newFeZone("s"));
    feZoneCandidateCount.mockResolvedValueOnce(7);

    await editor().promptFeZoneFit();
    expect(editor().feZoneFitPrompt).toEqual({ candidates: 7, automatic: 2 });

    editor().cancelFeZoneFit();
    expect(editor().feZoneFitPrompt).toBeNull();

    feZoneCandidateCount.mockResolvedValueOnce(7);
    await editor().promptFeZoneFit();
    feZoneFit.mockResolvedValueOnce([]);
    await editor().fitFeZones(3);
    expect(editor().feZoneFitPrompt).toBeNull();

    feZoneCandidateCount.mockRejectedValueOnce({ kind: "op", message: "not a scenario" });
    await editor().promptFeZoneFit();
    expect(editor().feZoneFitPrompt).toBeNull();
    expect(sessionError()).toBe("not a scenario");
  });
});
