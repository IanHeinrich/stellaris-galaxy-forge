import { describe, expect, it, vi } from "vitest";
import { recordingCanvas } from "../../test/canvas";
import { Camera } from "../Camera";
import type { InputKind } from "./MapIntent";
import { PointerBridge } from "./pointerBridge";

function bridged() {
  const canvas = recordingCanvas();
  const model = { handle: () => "consumed" as const, cursor: () => "" };
  const pick = (kind: InputKind, e: PointerEvent) => ({ kind, sx: e.offsetX, sy: e.offsetY });
  new PointerBridge(canvas, new Camera(), pick, model, { left: () => undefined }).bind();
  return canvas;
}

describe("a mouse press on the canvas", () => {
  it.each([
    ["left", 0, false],
    ["middle", 1, true],
    ["right", 2, true],
  ])("with the %s button (%i) cancels the default: %s", (_, button, kept) => {
    const canvas = bridged();
    const preventDefault = vi.fn();
    canvas.fire("mousedown", 10, 10, { button, preventDefault });
    expect(preventDefault.mock.calls.length > 0).toBe(kept);
  });
});
