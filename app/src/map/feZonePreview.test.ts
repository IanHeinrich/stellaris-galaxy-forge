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
});
