import { describe, expect, it } from "vitest";
import { at, recorder } from "../../test/mapIntent";
import { CENTRE, click, HANDLE_X, HANDLE_Y, LANE, LANE_EDGE, RING } from "./gestureFixture";
import { GestureModel } from "./GestureModel";
import type { MapInput } from "./MapIntent";

describe("GestureModel on a nebula", () => {
  it("a click on the ring or the centre selects it, and one inside it selects nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { nebula: RING });
    click(model, intent, { nebula: CENTRE });
    click(model, intent, {});
    expect(intent.calls).toEqual([["selectNebula", 3], ["selectNebula", 3], ["clearSelection"]]);
  });

  it("a system or a lane under the pointer wins over the nebula", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { system: 7, nebula: RING });
    click(model, intent, { edge: LANE_EDGE, nebula: RING });
    expect(intent.calls).toEqual([
      ["select", 7],
      ["selectLane", LANE],
    ]);
  });

  it("a drag on the ring moves it, previewing each point and committing the last", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: RING }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.busy()).toBe(true);
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("move", 40, 45), intent);
    model.handle(at("up", 40, 45), intent);
    expect(intent.calls).toEqual([
      ["previewNebula", 3, 30, 30],
      ["previewNebula", 3, 40, 45],
      ["commitNebula", 3, 40, 45],
    ]);
  });

  it("a drag on a handle previews the radius at each point and commits the last", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: HANDLE_X }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("move", 60, 20), intent);
    model.handle(at("up", 60, 20), intent);
    expect(intent.calls).toEqual([
      ["previewNebulaRadius", 3, 30, 30],
      ["previewNebulaRadius", 3, 60, 20],
      ["commitNebulaRadius", 3, 60, 20],
    ]);
  });

  it("a drag from the centre moves the nebula as the ring does, and a click there selects it", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: CENTRE }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("consumed");
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("up", 60, 20), intent);
    click(model, intent, { nebula: CENTRE });
    expect(intent.calls).toEqual([
      ["previewNebula", 3, 30, 30],
      ["commitNebula", 3, 60, 20],
      ["selectNebula", 3],
    ]);
  });

  it("idle cursor says move on the ring and the centre, and a resize arrow along the handle's axis", () => {
    const model = new GestureModel();
    const intent = recorder();
    const cursorAt = (extra: Partial<MapInput>) => {
      model.handle(at("move", 5, 5, extra), intent);
      return model.cursor();
    };
    expect(cursorAt({ nebula: RING })).toBe("move");
    expect(cursorAt({ nebula: HANDLE_X })).toBe("ew-resize");
    expect(cursorAt({ nebula: HANDLE_Y })).toBe("ns-resize");
    expect(cursorAt({ nebula: CENTRE })).toBe("move");
  });

  it("reset mid-drag drops the ghost ring and commits nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: RING }), intent);
    model.handle(at("move", 30, 30), intent);
    model.reset(intent);
    expect(model.busy()).toBe(false);
    model.handle(at("up", 30, 30), intent);
    model.handle(at("down", 10, 10, { nebula: HANDLE_Y }), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("cancel", 30, 30), intent);
    model.handle(at("up", 30, 30), intent);
    expect(intent.calls).toEqual([
      ["previewNebula", 3, 30, 30],
      ["endNebula"],
      ["previewNebulaRadius", 3, 30, 30],
      ["endNebula"],
    ]);
  });

  it("right-click on a nebula targets it, and on empty space keeps the space target", () => {
    const model = new GestureModel();
    const intent = recorder();
    for (const extra of [{ nebula: RING }, {}]) {
      model.handle(at("down", 10, 20, { ...extra, button: 2 }), intent);
      model.handle(at("up", 10, 20, { ...extra, button: 2 }), intent);
    }
    expect(intent.calls).toEqual([
      ["contextMenu", { kind: "nebula", index: 3 }, 10, 20],
      ["contextMenu", { kind: "space", x: 10, y: 20 }, 10, 20],
    ]);
  });

  it("shift-drag over a nebula still draws a marquee", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: RING, shift: true }), intent);
    model.handle(at("move", 40, 40, { shift: true }), intent);
    model.handle(at("up", 40, 40, { shift: true }), intent);
    expect(intent.calls).toEqual([
      ["previewMarquee", 10, 10, 40, 40],
      ["selectInRect", 10, 10, 40, 40, "replace"],
      ["endMarquee"],
    ]);
  });
});
