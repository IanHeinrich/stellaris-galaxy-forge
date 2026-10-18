import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { editor, openFixtureScenario } from "../store/editorFixture";
import { editResult } from "../store/fixture";
import { unlinkedPairs, useGalaxyStore } from "../store/galaxyStore";
import { mockedIpc } from "../test/ipc";
import {
  addLanes,
  everyPairRefusal,
  linkChoice,
  previewedLanes,
  showLanePreview,
} from "./useSelectionActions";

beforeEach(async () => {
  await openFixtureScenario();
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("Add lanes", () => {
  it("links every pair up to five systems, and nearby past them whatever was picked", () => {
    expect(linkChoice("every", everyPairRefusal(5))).toBe("every");
    expect(linkChoice("nearby", everyPairRefusal(5))).toBe("nearby");
    expect(linkChoice("every", everyPairRefusal(6))).toBe("nearby");
  });

  it("adds a lane to every unlinked pair for Every pair", async () => {
    await editor().setSelection([0, 1, 2], "replace");
    await addLanes("every");
    const lanes = unlinkedPairs(useGalaxyStore.getState().systems, [0, 1, 2]);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddLanePairs",
      lanes: lanes.map(([a, b]) => ({ a, b, bridge: false })),
    });
  });

  it("adds the nearby lanes past the every-pair limit", async () => {
    await editor().selectAll();
    expect(everyPairRefusal(editor().selection.length)).not.toBeNull();
    await addLanes("nearby");
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AddLanePairs" }),
    );
  });
});

describe("the lane preview", () => {
  const PAIRS: Array<[number, number]> = [[0, 2]];

  it("shows an action's lanes only while it is pointed at or focused", () => {
    expect(previewedLanes(true, PAIRS)).toBe(PAIRS);
    expect(previewedLanes(false, PAIRS)).toBeNull();
  });

  it("takes the lanes it showed off the map again, and shows nothing for none", () => {
    const set = vi.fn();
    const cleanup = showLanePreview(PAIRS, set);
    expect(set).toHaveBeenLastCalledWith(PAIRS);
    cleanup?.();
    expect(set).toHaveBeenLastCalledWith(null);

    set.mockClear();
    expect(showLanePreview(null, set)).toBeUndefined();
    expect(set).not.toHaveBeenCalled();
  });
});
