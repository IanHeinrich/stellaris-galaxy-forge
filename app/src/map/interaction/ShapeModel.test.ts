import { describe, expect, it } from "vitest";
import { at, recorder } from "../../test/mapIntent";
import { ShapeModel } from "./ShapeModel";

const SNAP = { snap: true, constrain: false };

describe("ShapeModel", () => {
  it("a press away from the shape draws a new one from the press point, and the release ends it", () => {
    const model = new ShapeModel();
    const intent = recorder();
    model.handle(at("move", 5, 5), intent);
    expect(model.cursor()).toBe("crosshair");
    model.handle(at("down", 10, 10), intent);
    expect(model.busy()).toBe(true);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("move", 40, 45, { shift: true }), intent);
    model.handle(at("up", 40, 45), intent);
    expect(model.busy()).toBe(false);
    const draw = { kind: "draw", anchor: { x: 10, y: 10 } };
    expect(intent.calls).toEqual([
      ["shapeDrag", draw, 30, 30, SNAP],
      ["shapeDrag", draw, 40, 45, { snap: true, constrain: true }],
      ["endShapeDrag", false],
    ]);
  });

  it("a press on a handle drags that handle, and one inside moves the shape from the press", () => {
    const intent = recorder();
    const handle = new ShapeModel();
    handle.handle(at("move", 10, 10, { shape: { kind: "handle", id: "rim" } }), intent);
    expect(handle.cursor()).toBe("grab");
    handle.handle(at("down", 10, 10, { shape: { kind: "handle", id: "rim" } }), intent);
    handle.handle(at("move", 20, 10), intent);
    expect(handle.cursor()).toBe("grabbing");
    const inside = new ShapeModel();
    inside.handle(at("move", 50, 50, { shape: { kind: "inside" } }), intent);
    expect(inside.cursor()).toBe("move");
    inside.handle(at("down", 50, 50, { shape: { kind: "inside" } }), intent);
    inside.handle(at("move", 60, 70), intent);
    expect(intent.calls).toEqual([
      ["shapeDrag", { kind: "handle", id: "rim" }, 20, 10, SNAP],
      ["shapeDrag", { kind: "move", press: { x: 50, y: 50 } }, 60, 70, SNAP],
    ]);
  });

  it("Ctrl at the press turns snapping off for the whole drag", () => {
    const model = new ShapeModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { ctrl: true }), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("move", 40, 40, { ctrl: true }), intent);
    expect(intent.calls.map((c) => c[4])).toEqual([
      { snap: false, constrain: false },
      { snap: false, constrain: false },
    ]);
  });

  it("a click that never passes the drag threshold leaves the shape alone", () => {
    const model = new ShapeModel();
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    model.handle(at("move", 11, 11), intent);
    model.handle(at("up", 11, 11), intent);
    model.handle(at("down", 50, 50, { shape: { kind: "inside" } }), intent);
    model.reset(intent);
    expect(intent.calls).toEqual([]);
  });

  it("Esc or a cancelled pointer mid-drag puts back the shape the drag started from", () => {
    const model = new ShapeModel();
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    model.handle(at("move", 30, 30), intent);
    model.reset(intent);
    expect(model.busy()).toBe(false);
    model.handle(at("up", 30, 30), intent);
    model.handle(at("down", 10, 10, { shape: { kind: "inside" } }), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("cancel", 30, 30), intent);
    expect(intent.calls.map((c) => c[0] === "endShapeDrag" && c)).toEqual([
      false,
      ["endShapeDrag", true],
      false,
      ["endShapeDrag", true],
    ]);
  });

  it("the middle button pans and never draws", () => {
    const model = new ShapeModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 1 }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("pan");
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("up", 30, 30, { button: 1 }), intent);
    expect(model.busy()).toBe(false);
    expect(intent.calls).toEqual([]);
  });
});
