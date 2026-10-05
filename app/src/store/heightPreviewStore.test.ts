import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { DEFAULT_SYSTEM_HEIGHT } from "../generated/constants";
import { mockedIpc } from "../test/ipc";
import { bindStores } from "./bindStores";
import { deferred, editor, openFixtureSave } from "./editorFixture";
import { editResult, SYSTEMS } from "./fixture";
import { useHeightPreviewStore } from "./heightPreviewStore";
import { until } from "../test/wait";

bindStores();

const previews = () => useHeightPreviewStore.getState();

beforeEach(async () => {
  await openFixtureSave();
  await editor().setSelection([0], "replace");
  previews().clear();
  previews().showBrush(new Map());
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
    await until(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1));
    expect(mockedIpc.applyOp.mock.calls[0][0]).toEqual({
      type: "SetSystemHeights",
      heights: [{ system: 0, height: DEFAULT_SYSTEM_HEIGHT + 30 }],
    });
    expect(previews().preview.get(0)).toBe(30);

    edit.resolve(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], height: DEFAULT_SYSTEM_HEIGHT + 30 }] } }),
    );
    await sent;
    expect(previews().preview.size).toBe(0);
  });

  it("keeps the brush's heights and the inspector's apart, each clearing only its own", () => {
    previews().showBrush(new Map([[0, 9]]));
    expect(previews().inspector.get(0)).toBeUndefined();
    expect(previews().preview.get(0)).toBe(9);

    previews().show(0, 30);
    previews().show(1, 4);
    expect(previews().inspector.get(0)).toBe(30);
    expect([...previews().preview].sort()).toEqual([
      [0, 30],
      [1, 4],
    ]);

    previews().clear();
    expect([...previews().preview]).toEqual([[0, 9]]);
    previews().show(1, 4);
    previews().showBrush(new Map());
    expect([...previews().preview]).toEqual([[1, 4]]);
  });

  it("sends the inspector's own height, whatever the brush previews", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    previews().showBrush(new Map([[0, 9]]));
    expect(await previews().commit(0)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();

    previews().show(0, 30);
    await previews().commit(0);
    expect(mockedIpc.applyOp.mock.calls[0][0]).toEqual({
      type: "SetSystemHeights",
      heights: [{ system: 0, height: DEFAULT_SYSTEM_HEIGHT + 30 }],
    });
    expect(previews().preview.get(0)).toBe(9);
  });

  it("is dropped when the selection changes", async () => {
    previews().show(0, 30);
    await editor().setSelection([1], "replace");
    expect(previews().preview.size).toBe(0);
  });
});
