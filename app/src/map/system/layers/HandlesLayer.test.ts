import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { SAVE_GEOMETRY } from "../../../lib/details/saveGeometry";
import { orbitClasses, orbitSystem } from "../../../test/builders";
import type { DragMarks } from "../bodyDrag";
import { systemContext, type SystemContext } from "../context";
import { drawOps, viewport } from "../fixture";
import { NO_SOURCES } from "../sources";
import { HandlesLayer } from "./HandlesLayer";

const BELT = { kind: "belt", index: 1 } as const;

const saved = (drag: DragMarks | null = null): SystemContext => {
  const ctx = systemContext({
    ...NO_SOURCES,
    id: 140,
    details: orbitSystem(),
    planetClasses: orbitClasses(),
    geometry: SAVE_GEOMETRY,
  });
  return drag ? { ...ctx, drag } : ctx;
};

const circles = (layer: HandlesLayer) =>
  drawOps(layer.container.children[0] as Graphics).filter((op) => op.action === "fill").length;

describe("the system scene's handles layer", () => {
  it("shows no handles until the pointer is over a band, then that band's six alone", () => {
    const layer = new HandlesLayer();
    layer.rebuild(saved());
    viewport(layer, 1);
    expect(circles(layer)).toBe(0);
    layer.reveal(BELT);
    expect(circles(layer)).toBe(6);
    expect(layer.shown().every((h) => h.ref.kind === "belt" && h.ref.index === 1)).toBe(true);
    layer.reveal(null);
    expect(circles(layer)).toBe(0);
  });

  it("keeps a dragged band's handles shown wherever the pointer goes", () => {
    const layer = new HandlesLayer();
    viewport(layer, 1);
    const drag: DragMarks = {
      body: null,
      ghost: null,
      tone: "own",
      other: null,
      host: null,
      handle: { kind: "innerRadius" },
      wormhole: null,
    };
    layer.rebuild(saved(drag));
    layer.reveal(null);
    expect(circles(layer)).toBe(6);
    expect(layer.shown().every((h) => h.ref.kind === "innerRadius")).toBe(true);
    layer.rebuild(saved());
    expect(circles(layer)).toBe(0);
  });
});
