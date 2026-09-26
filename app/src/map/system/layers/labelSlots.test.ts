import { describe, expect, it } from "vitest";
import { SELECTED_GAP_PX, SELECTED_WIDTH_PX } from "../geometry";
import { GAP_PX, placeLabels, plateScale, type LabelItem, type LabelBox } from "./labelSlots";

/** Bodies by world point, in the order the layer ranks them: the star, then planets by size. */
const BODIES = [
  { id: 1, x: 0, y: 0, r: 9 },
  { id: 2, x: 40, y: 10, r: 6 },
  { id: 3, x: 55, y: -20, r: 5 },
  { id: 4, x: -60, y: 15, r: 5 },
  { id: 5, x: 70, y: 5, r: 4 },
  { id: 6, x: 20, y: 60, r: 3 },
  { id: 7, x: -25, y: -50, r: 3 },
  { id: 8, x: 90, y: -8, r: 2 },
];

/** The same measured box for every name: the test is about the slots, not the metrics. */
const MEASURED = { w: 64, h: 16 };

function at(scale: number): LabelItem[] {
  return BODIES.map((b) => ({
    id: b.id,
    x: 400 + b.x * scale,
    y: 300 + b.y * scale,
    r: Math.max(3, b.r * scale),
    ...MEASURED,
  }));
}

/** A screen box's position and size, with or without the id a placed label carries too. */
type Rect = { x: number; y: number; w: number; h: number };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function pairwiseClear(boxes: readonly LabelBox[]): boolean {
  return boxes.every((a, i) => boxes.slice(i + 1).every((b) => !overlaps(a, b)));
}

/** A zero-sized item whose own label lands on `box`, taking it first. */
function taker(id: number, box: Rect): LabelItem {
  return { id, x: box.x + box.w / 2, y: box.y - GAP_PX, r: 0, w: box.w, h: box.h };
}

/** The four boxes a label of size `w` by `h` may take about a body at `x, y, r`. */
function headSlots(x: number, y: number, r: number, w = 64, h = 16) {
  const off = r + GAP_PX;
  return {
    below: { x: x - w / 2, y: y + off, w, h },
    above: { x: x - w / 2, y: y - off - h, w, h },
    right: { x: x + off, y: y - h / 2, w, h },
    left: { x: x - off - w, y: y - h / 2, w, h },
  };
}

/** The box about a body's disc and its selected ring, as `discBox` computes it. */
function discBox(x: number, y: number, r: number): Rect {
  const off = r + SELECTED_GAP_PX + SELECTED_WIDTH_PX;
  return { x: x - off, y: y - off, w: 2 * off, h: 2 * off };
}

describe("the system scene's label slots", () => {
  it("places no two labels over each other at the fit zoom", () => {
    const placed = placeLabels(at(3));
    expect(placed.length).toBe(BODIES.length);
    expect(pairwiseClear(placed)).toBe(true);
  });

  it("drops the lesser labels zoomed out rather than let them overlap, keeping the star's", () => {
    const placed = placeLabels(at(0.6));
    expect(pairwiseClear(placed)).toBe(true);
    expect(placed.length).toBeLessThan(BODIES.length);
    expect(placed[0].id).toBe(1);
  });

  it("centres a label under its body, then above, right and left as the ones placed before take each", () => {
    const body = { x: 400, y: 300, r: 10, ...MEASURED };
    const r = body.r + GAP_PX;
    const slot = {
      below: { id: 9, x: 368, y: 300 + r, w: 64, h: 16 },
      above: { id: 9, x: 368, y: 300 - r - 16, w: 64, h: 16 },
      right: { id: 9, x: 400 + r, y: 292, w: 64, h: 16 },
      left: { id: 9, x: 400 - r - 64, y: 292, w: 64, h: 16 },
    };
    const labelled = (takers: LabelItem[]) =>
      placeLabels([...takers, { id: 9, ...body }]).find((box) => box.id === 9);

    expect(labelled([])).toEqual(slot.below);
    expect(labelled([taker(1, slot.below)])).toEqual(slot.above);
    const both = [taker(1, slot.below), taker(2, slot.above)];
    expect(labelled(both)).toEqual(slot.right);
    expect(labelled([...both, taker(3, slot.right)])).toEqual(slot.left);
  });

  it("stands a plate clear of the selected ring", () => {
    const body: LabelItem = { id: 1, x: 400, y: 300, r: 10, ...MEASURED };
    const [box] = placeLabels([body]);
    expect(box.y).toBeGreaterThan(body.y + body.r + SELECTED_GAP_PX + SELECTED_WIDTH_PX);
  });

  /** A planet with four moons in a row out from it, `spacing` screen pixels apart, outermost first. */
  function jupiter(spacing: number): LabelItem {
    const moons = [4, 3, 2, 1].map((n) => ({
      id: 30 + n,
      x: 400 + n * spacing,
      y: 300,
      r: 2,
      ...MEASURED,
    }));
    return { id: 30, x: 400, y: 300, r: 6, ...MEASURED, moons };
  }

  it("puts each moon's plate under the moon while that slot is clear", () => {
    const placed = placeLabels([jupiter(80)]);
    expect(placed.map((box) => box.id).sort()).toEqual([30, 31, 32, 33, 34]);
    for (const box of placed) {
      const x = box.id === 30 ? 400 : 400 + (box.id - 30) * 80;
      const r = box.id === 30 ? 6 : 2;
      expect(box).toEqual({ id: box.id, x: x - 32, y: 300 + r + GAP_PX, w: 64, h: 16 });
    }
  });

  it("stacks crowded moons' plates down from their planet's, the outermost furthest down", () => {
    const placed = placeLabels([jupiter(8)]);
    expect(pairwiseClear(placed)).toBe(true);
    const top = (id: number) => placed.find((box) => box.id === id)?.y;
    const plate = 300 + 6 + GAP_PX;
    const step = 16 + 1;
    expect([34, 33, 32, 31, 30].map(top)).toEqual([4, 3, 2, 1, 0].map((n) => plate + n * step));
    expect(placed.every((box) => box.x === 368)).toBe(true);
  });

  it("moves a planet's plate and its moon column together to the next slot, the column still running away from the body", () => {
    // Exactly the below slot's own box, so the planet's plate cannot take it.
    const placed = placeLabels([taker(1, headSlots(400, 300, 6).below), jupiter(8)]);
    expect(pairwiseClear(placed)).toBe(true);
    const top = (id: number) => placed.find((box) => box.id === id)?.y;
    const plate = 300 - 6 - GAP_PX - 16;
    const step = 16 + 1;
    expect([34, 33, 32, 31, 30].map(top)).toEqual([4, 3, 2, 1, 0].map((n) => plate - n * step));
    expect(placed.every((box) => box.x === 368)).toBe(true);
  });

  it("drops a planet's plate and its moon column together when no slot clears both", () => {
    // Spans every slot's box, so neither the plate nor its column can land anywhere.
    const shelf: LabelItem = { id: 1, x: 400, y: 256, r: 0, w: 162, h: 66 };
    const placed = placeLabels([shelf, jupiter(8)]);
    expect(pairwiseClear(placed)).toBe(true);
    expect(placed.map((box) => box.id)).toEqual([1]);
  });

  it("never lets a crowded planet's plate or its moon column cross the planet's own disc, in any slot", () => {
    const planet = { id: 30, x: 400, y: 300, r: 25, ...MEASURED };
    const moons = [4, 3, 2, 1].map((n) => ({
      id: 30 + n,
      x: 400 + n * 8,
      y: 300,
      r: 2,
      ...MEASURED,
    }));
    const heads = headSlots(planet.x, planet.y, planet.r);
    const disc = discBox(planet.x, planet.y, planet.r);
    const blockedBefore = {
      below: [],
      above: [heads.below],
      right: [heads.below, heads.above],
      left: [heads.below, heads.above, heads.right],
    };
    for (const boxes of Object.values(blockedBefore)) {
      const blockers = boxes.map((box, i) => taker(100 + i, box));
      const placed = placeLabels([...blockers, { ...planet, moons }]);
      expect(pairwiseClear(placed)).toBe(true);
      const own = placed.filter((box) => box.id >= 30 && box.id <= 34);
      expect(own.length).toBe(5);
      for (const box of own) expect(overlaps(box, disc)).toBe(false);
    }
  });

  it("keeps each label clear of its own body", () => {
    const items = at(3);
    for (const box of placeLabels(items)) {
      const body = items.find((item) => item.id === box.id);
      if (!body) throw new Error("placed a label for no body");
      const nearestX = Math.min(Math.max(body.x, box.x), box.x + box.w);
      const nearestY = Math.min(Math.max(body.y, box.y), box.y + box.h);
      expect(Math.hypot(nearestX - body.x, nearestY - body.y)).toBeGreaterThanOrEqual(body.r);
    }
  });
});

describe("the system scene's plate size", () => {
  it("is full size from twice the fit in, and three quarters from half the fit out", () => {
    expect(plateScale(2)).toBe(1);
    expect(plateScale(10)).toBe(1);
    expect(plateScale(0.5)).toBe(0.75);
    expect(plateScale(0.25)).toBe(0.75);
  });

  it("eases down between the two as the view zooms out", () => {
    const zooms = [1.8, 1.4, 1, 0.7, 0.55];
    const sizes = zooms.map(plateScale);
    sizes.slice(1).forEach((size, i) => expect(size).toBeLessThan(sizes[i]));
  });
});
