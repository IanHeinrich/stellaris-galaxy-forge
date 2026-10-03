import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { DEFAULT_SYSTEM_HEIGHT } from "../generated/constants";
import { mockedIpc } from "../test/ipc";
import { bindStores } from "./bindStores";
import { deferred, editor, openFixtureSave } from "./editorFixture";
import { editResult, SYSTEMS } from "./fixture";
import { useHeightPreviewStore } from "./heightPreviewStore";

bindStores();

const previews = () => useHeightPreviewStore.getState();

beforeEach(async () => {
  await openFixtureSave();
  await editor().setSelection([0], "replace");
  previews().clear();
});

describe("a height preview", () => {
  it("holds a height per system until it is cleared, and sends nothing", () => {
    previews().show(0, 12.5);
    previews().show(1, -3);
    expect([...previews().preview]).toEqual([
      [0, 12.5],
      [1, -3],
    ]);

    previews().clear(1);
    expect([...previews().preview]).toEqual([[0, 12.5]]);
    previews().clear();
    expect(previews().preview.size).toBe(0);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("is sent as one edit and kept on the map until that edit settles", async () => {
    const edit = deferred<ReturnType<typeof editResult>>();
    mockedIpc.applyOp.mockReturnValueOnce(edit.promise);
    previews().show(0, 4);
    previews().show(0, 30);

    const sent = previews().commit(0);
    await vi.waitFor(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1));
    expect(mockedIpc.applyOp.mock.calls[0][0]).toEqual({
      type: "SetSystemHeights",
      heights: [{ id: 0, height: DEFAULT_SYSTEM_HEIGHT + 30 }],
    });
    expect(previews().preview.get(0)).toBe(30);

    edit.resolve(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], height: DEFAULT_SYSTEM_HEIGHT + 30 }] } }),
    );
    await sent;
    expect(previews().preview.size).toBe(0);
  });

  it("is dropped when the selection changes", async () => {
    previews().show(0, 30);
    await editor().setSelection([1], "replace");
    expect(previews().preview.size).toBe(0);
  });
});
