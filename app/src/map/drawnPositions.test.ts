import { describe, expect, it, vi } from "vitest";
import { OPEN_RESULT } from "../store/fixture";
import { systemNode } from "../test/builders";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { absoluteHeight } from "../lib/height";
import { useGalaxyStore } from "../store/galaxyStore";
import { Camera } from "./Camera";
import { DrawnPositions, LIFT_SCALE, type DrawnChange } from "./drawnPositions";

const RAISED = systemNode({ id: 1, x: 40, y: 30, height: absoluteHeight(100) });
const FLAT = systemNode({ id: 2, x: -40, y: 30 });

/** Drawn positions over a galaxy of a raised and a flat system, with every change it sends. */
function over() {
  useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: [RAISED, FLAT] });
  const cam = new Camera();
  cam.setViewport(800, 600);
  const drawn = new DrawnPositions(cam);
  const changes: DrawnChange[] = [];
  drawn.onChange((change) => changes.push(change));
  return { cam, drawn, changes };
}

describe("drawn positions", () => {
  it("are the plane positions while the map lies flat, previews or not", () => {
    const { drawn } = over();
    drawn.setPreview(new Map([[2, 50]]));
    expect(drawn.at(RAISED)).toBe(RAISED);
    expect(drawn.at(FLAT)).toBe(FLAT);
    expect(drawn.reach()).toBe(0);
    expect(drawn.pickGrid()).toBe(useGalaxyStore.getState().grid);
  });

  it("lift a system by half its height times the tangent, which the camera squashes to the sine", () => {
    const { cam, drawn } = over();
    drawn.setTilt(30);
    const tan = Math.tan(Math.PI / 6);
    expect(drawn.y(RAISED)).toBeCloseTo(30 - 100 * LIFT_SCALE * tan);
    expect(drawn.y(FLAT)).toBe(30);
    const plane = cam.worldToScreen(40, 30);
    const star = cam.worldToScreen(40, drawn.y(RAISED));
    expect(plane.y - star.y).toBeCloseTo(100 * LIFT_SCALE * Math.sin(Math.PI / 6) * cam.scale);
    expect(drawn.reach()).toBeCloseTo(100 * LIFT_SCALE * tan);
  });

  it("lift a previewed system by the height it previews", () => {
    const { drawn } = over();
    drawn.setTilt(30);
    drawn.setPreview(new Map([[2, -40]]));
    expect(drawn.y(FLAT)).toBeCloseTo(30 + 40 * LIFT_SCALE * Math.tan(Math.PI / 6));
    expect(drawn.atPoint(FLAT, { x: 0, y: 0 }).y).toBeCloseTo(drawn.y(FLAT) - 30);
  });

  it("name only the systems a change moves", () => {
    const { drawn, changes } = over();
    drawn.setPreview(new Map([[2, 50]]));
    expect(changes).toEqual([{ moved: new Set(), heights: new Set([2]), leaned: false }]);

    drawn.setTilt(30);
    expect(changes[1]).toEqual({ moved: new Set([1, 2]), heights: new Set(), leaned: true });

    drawn.setPreview(new Map([[2, 50]]));
    drawn.setPreview(new Map([[1, 10]]));
    expect(changes[2]).toEqual({ moved: new Set([1, 2]), heights: new Set([1, 2]), leaned: false });
    drawn.setTilt(30);
    expect(changes).toHaveLength(3);
  });

  it("find systems in pick space where they draw, squashed as the screen squashes them", () => {
    const { drawn } = over();
    drawn.setTilt(60);
    const at = drawn.toPick({ x: 40, y: drawn.y(RAISED) });
    expect(drawn.pickGrid()?.nearestSystem(at.x, at.y, 1)?.id).toBe(1);
    drawn.setPreview(new Map([[1, 0]]));
    const plane = drawn.toPick({ x: 40, y: 30 });
    expect(drawn.pickGrid()?.nearestSystem(plane.x, plane.y, 1)?.id).toBe(1);
  });
});
