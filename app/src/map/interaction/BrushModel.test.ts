import { describe, expect, it } from "vitest";
import { at, recorder } from "../../test/mapIntent";
import { BrushModel } from "./BrushModel";

describe("BrushModel", () => {
  it("lays one stroke from press to release and commits it once", () => {
    const model = new BrushModel("paint");
    const intent = recorder();
    model.handle(at("move", 5, 5), intent);
    model.handle(at("down", 10, 10), intent);
    expect(model.busy()).toBe(true);
    expect(model.handle(at("move", 30, 30), intent)).toBe("consumed");
    model.handle(at("move", 40, 45), intent);
    model.handle(at("up", 40, 45), intent);
    expect(model.busy()).toBe(false);
    expect(model.cursor()).toBe("crosshair");
    expect(intent.calls).toEqual([
      ["hoverBrush", "paint", 5, 5],
      ["beginStroke", "paint", 10, 10],
      ["extendStroke", 30, 30],
      ["extendStroke", 40, 45],
      ["commitStroke"],
      ["hoverBrush", "paint", 40, 45],
    ]);
  });

  it("a cancelled stroke, or one Esc drops, commits nothing", () => {
    const model = new BrushModel("erase");
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("cancel", 30, 30), intent);
    model.handle(at("down", 10, 10), intent);
    model.reset(intent);
    model.handle(at("up", 10, 10), intent);
    expect(intent.calls).toEqual([
      ["beginStroke", "erase", 10, 10],
      ["extendStroke", 30, 30],
      ["cancelStroke"],
      ["endBrush"],
      ["beginStroke", "erase", 10, 10],
      ["cancelStroke"],
      ["endBrush"],
    ]);
  });

  it("Alt held at the press inverts the stroke, and the circle shows it", () => {
    const intent = recorder();
    new BrushModel("paint").handle(at("down", 10, 10, { alt: true }), intent);
    new BrushModel("erase").handle(at("down", 10, 10, { alt: true }), intent);
    new BrushModel("erase").handle(at("move", 12, 12, { alt: true }), intent);
    expect(intent.calls).toEqual([
      ["beginStroke", "erase", 10, 10],
      ["beginStroke", "paint", 10, 10],
      ["hoverBrush", "paint", 12, 12],
    ]);
  });

  it("the middle button pans and never strokes", () => {
    const model = new BrushModel("paint");
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 1 }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("pan");
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("up", 30, 30, { button: 1 }), intent);
    expect(model.busy()).toBe(false);
    expect(intent.calls).toEqual([["endBrush"], ["hoverBrush", "paint", 30, 30]]);
  });

  it("the lane brushes stroke as the others do, and Alt turns Connect and Cut into each other", () => {
    const intent = recorder();
    const connect = new BrushModel("connect");
    connect.handle(at("down", 10, 10), intent);
    connect.handle(at("up", 10, 10), intent);
    new BrushModel("connect").handle(at("down", 10, 10, { alt: true }), intent);
    new BrushModel("cut").handle(at("down", 10, 10, { alt: true }), intent);
    new BrushModel("cut").handle(at("move", 12, 12), intent);
    new BrushModel("cut").handle(at("move", 12, 12, { alt: true }), intent);
    expect(intent.calls).toEqual([
      ["beginStroke", "connect", 10, 10],
      ["commitStroke"],
      ["hoverBrush", "connect", 10, 10],
      ["beginStroke", "cut", 10, 10],
      ["beginStroke", "connect", 10, 10],
      ["hoverBrush", "cut", 12, 12],
      ["hoverBrush", "connect", 12, 12],
    ]);
  });

  it("Alt on Erase follows its target: systems paint, and lanes only connect", () => {
    const intent = recorder();
    let target: "systems" | "lanes" = "lanes";
    const erase = new BrushModel("erase", () => target);
    erase.handle(at("move", 12, 12, { alt: true }), intent);
    erase.handle(at("down", 10, 10, { alt: true }), intent);
    erase.handle(at("up", 10, 10, { alt: true }), intent);
    target = "systems";
    erase.handle(at("down", 10, 10, { alt: true }), intent);
    expect(intent.calls).toEqual([
      ["hoverBrush", "connect", 12, 12],
      ["beginStroke", "connect", 10, 10],
      ["commitStroke"],
      ["hoverBrush", "connect", 10, 10],
      ["beginStroke", "paint", 10, 10],
    ]);
  });
});
