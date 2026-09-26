import { describe, expect, it } from "vitest";
import { placeLabels, type LabelItem, type LabelBox } from "./labelSlots";

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

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function pairwiseClear(boxes: readonly LabelBox[]): boolean {
  return boxes.every((a, i) => boxes.slice(i + 1).every((b) => !overlaps(a, b)));
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
