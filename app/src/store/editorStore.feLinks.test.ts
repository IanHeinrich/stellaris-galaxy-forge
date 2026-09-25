import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { SystemNode } from "../generated/SystemNode";
import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { FE_LINK_ANCHOR, FE_LINKED, SYSTEMS, editResult } from "./fixture";

const setFeLinks = mocked.setFeLinks;

/** Puts `nodes` into the galaxy the store reads, over the fixture's own. */
function place(...nodes: SystemNode[]): void {
  useGalaxyStore.getState().applyDelta({ systems: nodes });
}

/** Vega, linked to the same zone as Deneb. */
const ALSO_LINKED: SystemNode = { ...SYSTEMS[4], fe_link: { custom: false, id: null, to: [2] } };

beforeEach(async () => {
  await openFixtureSave();
  useMapChromeStore.setState({
    layers: { ...useMapChromeStore.getState().layers, feZones: false },
  });
  place(FE_LINK_ANCHOR, FE_LINKED);
  setFeLinks.mockResolvedValue(editResult());
});

describe("a fallen empire zone's custom connections", () => {
  it("linkToFeZone sends the zone's linked systems with the new one, and shows the rings", async () => {
    expect(await editor().linkToFeZone(3, 0)).toBe(true);
    expect(setFeLinks).toHaveBeenCalledWith(3, [5, 0]);
    expect(useMapChromeStore.getState().layers.feZones).toBe(true);
  });

  it("linkToFeZone refuses an anchor without a zone, and a system already linked, before sending anything", async () => {
    expect(await editor().linkToFeZone(0, 5)).toBe(false);
    expect(sessionError()).toBe("Sol anchors no fallen empire zone");

    expect(await editor().linkToFeZone(3, 5)).toBe(false);
    expect(sessionError()).toBe("Deneb is already linked to Sirius's fallen empire zone");
    expect(setFeLinks).not.toHaveBeenCalled();
    expect(useMapChromeStore.getState().layers.feZones).toBe(false);
  });

  it("linkToFeZoneAll links a selection in one op, skipping the anchor and the already linked", async () => {
    expect(await editor().linkToFeZoneAll(3, [4, 0, 3, 5, 1, 0])).toBe(true);
    expect(setFeLinks).toHaveBeenCalledTimes(1);
    expect(setFeLinks).toHaveBeenCalledWith(3, [5, 0, 1, 4]);
    expect(sessionError()).toBeNull();
    expect(useMapChromeStore.getState().layers.feZones).toBe(true);
  });

  it("linkToFeZoneAll reports the first refusal only when nothing could be linked", async () => {
    expect(await editor().linkToFeZoneAll(3, [3, 5])).toBe(false);
    expect(sessionError()).toBe("Sirius cannot link to its own zone");
    expect(await editor().linkToFeZoneAll(3, [])).toBe(false);
    expect(await editor().linkToFeZoneAll(99, [0])).toBe(false);
    expect(setFeLinks).not.toHaveBeenCalled();
  });

  it("unlinkFromFeZone sends the rest of the zone's links, and refuses a system not linked", async () => {
    place(ALSO_LINKED);
    expect(await editor().unlinkFromFeZone(3, 5)).toBe(true);
    expect(setFeLinks).toHaveBeenCalledWith(3, [4]);
    expect(useMapChromeStore.getState().layers.feZones).toBe(true);

    expect(await editor().unlinkFromFeZone(3, 0)).toBe(false);
    expect(sessionError()).toBe("Sol is not linked to Sirius's fallen empire zone");
    expect(setFeLinks).toHaveBeenCalledTimes(1);
  });

  it("resetFeLinks sends an empty list, which gives the zone back to the mod's rule", async () => {
    expect(await editor().resetFeLinks(3)).toBe(true);
    expect(setFeLinks).toHaveBeenCalledWith(3, []);
    expect(await editor().resetFeLinks(99)).toBe(false);
  });

  it("dropDanglingFeLinks keeps the ids a zone takes and drops the rest, in one op", async () => {
    place({ ...FE_LINKED, fe_link: { custom: false, id: null, to: [2, 5] } });
    mocked.applyOp.mockResolvedValue(editResult());
    expect(await editor().dropDanglingFeLinks(5)).toBe(true);
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "SetFeLinkFlags",
      entries: [[5, { custom: false, id: null, to: [2] }]],
    });
    expect(setFeLinks).not.toHaveBeenCalled();

    place(FE_LINKED);
    expect(await editor().dropDanglingFeLinks(5)).toBe(true);
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
  });

  it("reports a refused command as the session error", async () => {
    setFeLinks.mockRejectedValueOnce({ kind: "op", message: "Sirius anchors no zone" });
    expect(await editor().linkToFeZone(3, 0)).toBe(false);
    expect(sessionError()).toBe("Sirius anchors no zone");
    expect(useMapChromeStore.getState().layers.feZones).toBe(false);
  });
});
