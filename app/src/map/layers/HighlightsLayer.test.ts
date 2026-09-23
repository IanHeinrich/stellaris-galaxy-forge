import type { Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { newFeZone } from "../../lib/feZone";
import { lanesTo, systemNode } from "../../test/builders";
import { HighlightsLayer } from "./HighlightsLayer";
import { childByLabel, drawOps, mapContext, mapNode, strokes, viewport } from "./fixture";

/** An anchor at the origin whose ring lies east at 40, centred on (-40, 0), taking links under 5. */
const ANCHOR: SystemNode = {
  ...mapNode(0, 0, "S0"),
  fe_zone: newFeZone("e"),
  fe_link: { custom: true, id: 5, to: [] },
};
/** Linked to the anchor's zone: its link runs from (200, 0) to the ring at (-10, 0). */
const LINKED: SystemNode = {
  ...mapNode(1, 200, "S1"),
  fe_link: { custom: false, id: null, to: [5] },
};
const LANE_A = systemNode({
  id: 2,
  x: 100,
  y: 100,
  lanes: lanesTo(3),
});
const LANE_B = systemNode({
  id: 3,
  x: 300,
  y: 100,
  lanes: lanesTo(2),
});

const LANE = { kind: "lane", lane: { a: 2, b: 3 } } as const;
const LINK = { kind: "feLink", anchor: 0, system: 1 } as const;

function drawn(scale = 1): HighlightsLayer {
  const layer = new HighlightsLayer();
  layer.rebuild(mapContext([ANCHOR, LINKED, LANE_A, LANE_B], { paintLayer: true }));
  viewport(layer, scale);
  return layer;
}

function graphics(layer: HighlightsLayer, label: string): Graphics {
  return layer.container.getChildByLabel(label, true) as Graphics;
}

/** The straights a graphics strokes, as `[ax, ay, bx, by]`. */
function strokedSegments(g: Graphics): number[][] {
  return drawOps(g)
    .filter((op) => op.action === "stroke")
    .flatMap((op) => op.segments);
}

/** The circle a target ring strokes, as `[x, y, radius, color]`. */
function targetRing(layer: HighlightsLayer): (number | undefined)[] | null {
  const op = drawOps(graphics(layer, "target")).find((o) => o.action === "stroke");
  return op ? [...op.segments[0], op.color] : null;
}

describe("the highlights layer on edges", () => {
  it("strokes the hovered lane or zone link and puts the × at its midpoint", () => {
    const layer = drawn();
    const midpoint = graphics(layer, "midpoint");
    expect(midpoint.visible).toBe(false);

    layer.setHoverEdge(LANE);
    expect(strokedSegments(graphics(layer, "laneLines"))).toEqual([[100, 100, 300, 100]]);
    expect([midpoint.visible, midpoint.x, midpoint.y]).toEqual([true, 200, 100]);

    layer.setHoverEdge(LINK);
    expect(strokedSegments(graphics(layer, "laneLines"))).toEqual([[200, 0, -10, 0]]);
    expect([midpoint.visible, midpoint.x, midpoint.y]).toEqual([true, 95, 0]);

    layer.setHoverEdge(null);
    expect(strokedSegments(graphics(layer, "laneLines"))).toEqual([]);
    expect(midpoint.visible).toBe(false);
  });

  it("drops the hover of a link the file no longer draws", () => {
    const layer = drawn();
    layer.setHoverEdge({ kind: "feLink", anchor: 0, system: 2 });
    expect(strokedSegments(graphics(layer, "laneLines"))).toEqual([]);
    expect(graphics(layer, "midpoint").visible).toBe(false);
  });
});

describe("the highlights layer on a pending link", () => {
  it("rubber-lines a drag from systems to the pointer, then to the snapped ring's nearest point, and rings the ring", () => {
    const layer = drawn();
    layer.setRubberLane({ from: { kind: "systems", ids: [1] }, x: 50, y: 20, target: null });
    expect(strokedSegments(graphics(layer, "previewLines"))).toEqual([[200, 0, 50, 20]]);
    expect(targetRing(layer)).toBeNull();

    const valid = { kind: "feZone", anchor: 0, valid: true } as const;
    layer.setRubberLane({ from: { kind: "systems", ids: [1] }, x: -50, y: 0, target: valid });
    expect(strokedSegments(graphics(layer, "previewLines"))).toEqual([[200, 0, -10, 0]]);
    expect(targetRing(layer)).toEqual([-40, 0, 44, 0x6ee7b7]);

    layer.setRubberLane({
      from: { kind: "systems", ids: [1] },
      x: -50,
      y: 0,
      target: { ...valid, valid: false },
    });
    expect(targetRing(layer)).toEqual([-40, 0, 44, 0xf87171]);

    layer.setRubberLane(null);
    expect(strokedSegments(graphics(layer, "previewLines"))).toEqual([]);
    expect(targetRing(layer)).toBeNull();
  });

  it("keeps the target ring the same width on screen as the map zooms", () => {
    const layer = drawn(2);
    layer.setRubberLane({
      from: { kind: "systems", ids: [1] },
      x: -50,
      y: 0,
      target: { kind: "feZone", anchor: 0, valid: true },
    });
    expect(targetRing(layer)).toEqual([-40, 0, 37, 0x6ee7b7]);
  });

  it("rubber-lines a drag from a zone's port to the pointer, then to the snapped system, ringing it as a star", () => {
    const layer = drawn();
    layer.setRubberLane({ from: { kind: "feZone", anchor: 0 }, x: 100, y: 0, target: null });
    expect(strokedSegments(graphics(layer, "previewLines"))).toEqual([[100, 0, -10, 0]]);

    layer.setRubberLane({
      from: { kind: "feZone", anchor: 0 },
      x: 100,
      y: 0,
      target: { kind: "system", id: 1, valid: true },
    });
    expect(strokedSegments(graphics(layer, "previewLines"))).toEqual([[200, 0, -10, 0]]);
    expect(targetRing(layer)).toEqual([200, 0, 13, 0x6ee7b7]);
  });

  it("draws no rubber line from inside the ring", () => {
    const layer = drawn();
    layer.setRubberLane({ from: { kind: "feZone", anchor: 0 }, x: -40, y: 0, target: null });
    expect(strokedSegments(graphics(layer, "previewLines"))).toEqual([]);
  });
});

describe("the highlights layer's port ring", () => {
  /** Where a dashed ring starts: its first dash's move, `[x, y]`. */
  const startOf = (g: Graphics) => strokedSegments(g)[0]?.slice(0, 2);

  it("dashes a ring just outside the hovered zone's ring band, and around a hovered star", () => {
    const layer = drawn();
    const port = graphics(layer, "port");
    expect(startOf(port)).toBeUndefined();

    layer.setHoverFeZone(0);
    expect(startOf(port)).toEqual([-1, 0]);

    layer.setHoverFeZone(null);
    expect(startOf(port)).toBeUndefined();

    layer.setHover(1);
    expect(startOf(port)).toEqual([213, 0]);
  });

  it("brightens on the port band and hides while a lane is being drawn", () => {
    const layer = drawn();
    const port = graphics(layer, "port");
    layer.setHoverFeZone(0);
    expect(port.alpha).toBe(0.45);
    layer.setPortHot(true);
    expect(port.alpha).toBe(1);
    layer.setRubberLane({ from: { kind: "feZone", anchor: 0 }, x: 100, y: 0, target: null });
    expect(startOf(port)).toBeUndefined();
  });
});

describe("the highlights layer's selection", () => {
  /** Where the shown rings of a batch sit, `[x, y]`. */
  const ringsOf = (layer: HighlightsLayer, label: string) =>
    childByLabel(layer.container, label)
      .children.filter((g) => g.visible)
      .map((g) => [g.x, g.y]);

  it("rings the selection, and a hover or an unrelated delta leaves the rings alone", () => {
    const layer = drawn();
    layer.setSelection([1, 2]);
    expect(ringsOf(layer, "selectionRings")).toEqual([
      [200, 0],
      [100, 100],
    ]);
    const first = childByLabel(layer.container, "selectionRings").children[0];
    const moved = vi.spyOn(first.position, "set");

    layer.setHover(3);
    layer.setHover(1);
    layer.setHover(null);
    const far = { ...LANE_B, x: 320 };
    layer.rebuild(mapContext([ANCHOR, LINKED, LANE_A, far], { paintLayer: true }));
    layer.applyDelta({ systems: [far] });
    expect(moved).not.toHaveBeenCalled();

    const selected = { ...LANE_A, x: 120 };
    layer.rebuild(mapContext([ANCHOR, LINKED, selected, far], { paintLayer: true }));
    layer.applyDelta({ systems: [selected] });
    expect(ringsOf(layer, "selectionRings")).toEqual([
      [200, 0],
      [120, 100],
    ]);
  });

  it("rescales the rings with the zoom and hides the spare ones", () => {
    const layer = drawn(4);
    layer.setSelection([1, 2]);
    const ring = childByLabel(layer.container, "selectionRings").children[0];
    const near = Math.abs(ring.scale.x);
    viewport(layer, 1);
    expect(Math.abs(ring.scale.x)).toBeGreaterThan(near);

    layer.setSelection([2]);
    expect(ringsOf(layer, "selectionRings")).toEqual([[100, 100]]);
  });
});

describe("the highlights layer's symmetry guides", () => {
  it("draws a mirror's axis to a scenario's corners and a rotation's spokes to a save's radius", () => {
    const layer = drawn();
    const guide = graphics(layer, "symmetryGuide");
    expect(strokes(guide)).toEqual([]);

    layer.guide.set({ kind: "mirror", axis: "x" });
    const corner = 500 * Math.SQRT2;
    expect(strokedSegments(guide)).toEqual([[-corner, 0, corner, 0]]);

    layer.rebuild(mapContext([ANCHOR], { kind: "save", radius: 300 }));
    layer.guide.set({ kind: "rotate", n: 4 });
    expect(strokedSegments(guide)).toEqual([
      [0, 0, 300, 0],
      [0, 0, 0, 300],
      [0, 0, -300, 0],
      [0, 0, 0, -300],
    ]);

    layer.guide.set(null);
    expect(strokes(guide)).toEqual([]);
  });

  it("rings the brush circle's copies at each image, fainter than the one at the pointer", () => {
    const layer = drawn();
    layer.brush.setCursor({
      tool: "paint",
      x: 100,
      y: 50,
      r: 10,
      symmetry: { kind: "rotate", n: 4 },
    });
    const centres = (op: { segments: number[][] }) => [
      ...new Set(op.segments.map((seg) => `${seg[2]},${seg[3]}`)),
    ];
    const [pointer, copies] = strokes(graphics(layer, "brushCircle"));
    expect(centres(pointer)).toEqual(["100,50"]);
    expect(pointer.alpha).toBe(0.9);
    expect(centres(copies)).toEqual(["-50,100", "-100,-50", "50,-100"]);
    expect(copies.alpha).toBeLessThan(pointer.alpha!);

    layer.brush.setCursor({ tool: "cut", x: 100, y: 50, r: 10, symmetry: { kind: "off" } });
    expect(strokes(graphics(layer, "brushCircle"))).toHaveLength(1);
  });
});
