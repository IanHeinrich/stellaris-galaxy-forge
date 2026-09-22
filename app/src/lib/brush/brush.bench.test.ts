import { describe, expect, it } from "vitest";
import { buildGalaxy } from "../geometry/territory.fixture";
import { MESH_BETA, type MeshPoint } from "../geometry/mesh";
import type { Pt } from "../geometry/pt";
import { laneSegments, strokeLanes, withProvisionalIds } from "./lanes";
import { seeded } from "./random";
import { SAMPLE_CAP, sampleStroke } from "./sample";
import { stampsAlong } from "./stroke";

const BLOCKER_COUNT = 600;
const R = 120;
const SPACING = 10;
/** Generous so a slow CI runner does not fail it; locally the whole run takes a fraction of this. */
const BUDGET_MS = 1000;

describe("a paint stroke at the sample cap", () => {
  it("samples and meshes against 600 systems within budget", () => {
    const systems = [...buildGalaxy().systems].sort((a, b) => a.x - b.x).slice(0, BLOCKER_COUNT);
    const blockers: MeshPoint[] = systems.map(({ id, x, y }) => ({ id, x, y }));
    const existing = laneSegments(systems);
    const stamps: Pt[] = [];
    let prev: Pt | null = null;
    [-360, -150, 60, 270].forEach((y, row) => {
      for (const x of row % 2 === 0 ? [-500, 500] : [500, -500]) {
        stamps.push(...stampsAlong(prev, { x, y }, R));
        prev = stamps[stamps.length - 1];
      }
    });

    const start = performance.now();
    const points = sampleStroke(stamps, R, SPACING, blockers, seeded(1));
    const lanes = strokeLanes({
      added: withProvisionalIds(points),
      nearby: blockers,
      existing,
      beta: MESH_BETA.gabriel,
      mode: "nearby",
      maxLength: 3 * SPACING,
    });
    const elapsed = performance.now() - start;

    expect(points).toHaveLength(SAMPLE_CAP);
    expect(lanes.length).toBeGreaterThan(SAMPLE_CAP);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
