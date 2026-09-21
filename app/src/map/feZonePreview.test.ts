import { describe, expect, it } from "vitest";
import { systemNode } from "../test/builders";
import { feZonePreview } from "./feZonePreview";

const anchor = systemNode({ id: 1, x: 0, y: 0 });
const near = systemNode({ id: 2, x: -60, y: 0 });
const systems = new Map([anchor, near].map((s) => [s.id, s]));

describe("feZonePreview", () => {
  it("snaps the pointer to the grid around the anchor and says what the ring would cover", () => {
    expect(feZonePreview(systems, 1, { x: -52, y: 3 })).toMatchObject({
      anchor: { x: 0, y: 0 },
      direction: "e",
      distance: 50,
      x: -50,
      y: 0,
      blocked: near,
      offMap: false,
    });
    expect(feZonePreview(systems, 1, { x: 0, y: -100 })).toMatchObject({
      direction: "n",
      distance: 100,
      blocked: null,
    });
  });

  it("answers nothing for an anchor the galaxy no longer holds", () => {
    expect(feZonePreview(systems, 7, { x: 0, y: 0 })).toBeNull();
  });

  it("gives all 144 positions on the mod's grid, with the snapped one among them", () => {
    const preview = feZonePreview(systems, 1, { x: -52, y: 3 })!;
    expect(preview.slots).toHaveLength(144);
    expect(preview.slots).toContainEqual(
      expect.objectContaining({ direction: preview.direction, distance: preview.distance }),
    );
  });

  it("marks a slot whose ring would cover a system as not clear", () => {
    const preview = feZonePreview(systems, 1, { x: -52, y: 3 })!;
    expect(preview.slots.find((s) => s.direction === "e" && s.distance === 40)).toMatchObject({
      clear: false,
    });
    expect(preview.slots.find((s) => s.direction === "n" && s.distance === 100)).toMatchObject({
      clear: true,
    });
  });

  it("marks a slot past the mod's ±470 canvas as not clear", () => {
    const edge = systemNode({ id: 3, x: 300, y: 0 });
    const edgeSystems = new Map([edge].map((s) => [s.id, s]));
    const preview = feZonePreview(edgeSystems, 3, { x: 500, y: 0 })!;
    expect(preview.slots.find((s) => s.direction === "w" && s.distance === 200)).toMatchObject({
      clear: false,
    });
  });
});
