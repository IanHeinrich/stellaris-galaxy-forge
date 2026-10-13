import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { polar, screenDirection } from "../../lib/details/orbits";
import { Camera } from "../../map/Camera";
import { AngleDial } from "./AngleDial";

/** The dial's radius, as it draws its rim. */
const R = 12;

/** Where the dial puts a save angle on its rim, from the direction the scene turns it. */
function onRim(angle: number): { x: string; y: string } {
  const d = screenDirection(angle);
  return { x: (d.x * R).toFixed(2), y: (d.y * R).toFixed(2) };
}

/** The SVG sweep flag of an arc drawn the way save angles grow on screen, from the system view's camera. */
function growingSweep(): string {
  const camera = new Camera();
  camera.setViewport(2, 2);
  const at = (angle: number) => {
    const world = polar(0, 0, 1, angle);
    const screen = camera.worldToScreen(world.x, world.y);
    return { x: screen.x - 1, y: screen.y - 1 };
  };
  const [a, b] = [at(30), at(31)];
  return a.x * b.y - a.y * b.x > 0 ? "1" : "0";
}

const dial = (min: number, max: number) => renderToStaticMarkup(<AngleDial step={{ min, max }} />);

describe("the angle dial", () => {
  it("draws a ranged step as a wedge, a fixed step as a line to a dot, and any angle as the whole disc", () => {
    const ranged = dial(30, 120);
    expect(ranged).toContain("ins-dial-wedge");
    const to = onRim(120);
    expect(ranged).toContain(`A${R} ${R} 0 0 ${growingSweep()} ${to.x} ${to.y}`);
    expect(ranged).toContain("ins-dial-ref");
    expect(ranged).not.toContain("ins-dial-line");
    expect(ranged).not.toContain("ins-dial-any");

    const fixed = dial(70, 70);
    expect(fixed).toContain("ins-dial-line");
    expect(fixed).toContain("ins-dial-at");
    expect(fixed).not.toContain("ins-dial-wedge");

    const any = dial(0, 360);
    expect(any).toContain("ins-dial-any");
    expect(any).not.toContain("ins-dial-wedge");
    expect(any).not.toContain("ins-dial-line");
    expect(any).not.toContain("ins-dial-ref");
  });

  it("draws nothing for a step it can't tell", () => {
    expect(renderToStaticMarkup(<AngleDial step={null} />)).toBe("");
  });
});

describe("screenDirection", () => {
  it("points each save angle the way the system view's camera draws it", () => {
    const camera = new Camera();
    camera.setViewport(2, 2);
    for (const angle of [0, 37, 90, 145, 200, 270, 333]) {
      const world = polar(0, 0, 1, angle);
      const screen = camera.worldToScreen(world.x, world.y);
      const d = screenDirection(angle);
      expect(d.x).toBeCloseTo(screen.x - 1, 9);
      expect(d.y).toBeCloseTo(screen.y - 1, 9);
    }
  });
});
