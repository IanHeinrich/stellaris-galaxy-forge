import { describe, expect, it } from "vitest";
import { DEFAULT_LANE_DENSITY, meshPairs, type MeshPoint } from "./mesh";

const COUNT = 1000;
const BUDGET_MS = 50;

describe("a mesh over a circle outline", () => {
  it("meshes 1000 points in convex position within budget", () => {
    const outline: MeshPoint[] = Array.from({ length: COUNT }, (_, id) => {
      const t = (2 * Math.PI * id) / COUNT;
      return { id, x: 300 * Math.cos(t), y: 300 * Math.sin(t) };
    });
    const start = performance.now();
    const pairs = meshPairs(outline, DEFAULT_LANE_DENSITY);
    const elapsed = performance.now() - start;

    expect(pairs.length).toBeGreaterThanOrEqual(COUNT - 1);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
