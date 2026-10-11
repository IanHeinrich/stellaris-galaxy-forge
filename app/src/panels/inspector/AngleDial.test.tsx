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

/**
 * The SVG sweep flag of an arc drawn the way save angles grow on screen, from the system view's
 * camera as the screenDirection test reads it.
 */
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

describe("the angle dial", () => {
  it("draws a ranged step as a wedge from the body before it, between the step's ends", () => {
    const html = renderToStaticMarkup(<AngleDial step={{ min: 30, max: 120 }} />);
    const from = onRim(30);
    const to = onRim(120);
    expect(html).toContain(
      `<path class="ins-dial-wedge" d="M0 0 L${from.x} ${from.y} A12 12 0 0 ${growingSweep()} ${to.x} ${to.y} Z"></path>`,
    );
    expect(html).not.toContain("ins-dial-line");
    expect(html).not.toContain("ins-dial-any");
    const reference = onRim(0);
    expect(html).toContain(
      `<circle class="ins-dial-ref" cx="${reference.x}" cy="${reference.y}" r="2"></circle>`,
    );
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws a fixed step as a line to a dot at that angle", () => {
    const html = renderToStaticMarkup(<AngleDial step={{ min: 70, max: 70 }} />);
    const at = onRim(70);
    expect(html).toContain(
      `<line class="ins-dial-line" x1="0" y1="0" x2="${at.x}" y2="${at.y}"></line>`,
    );
    expect(html).toContain(`<circle class="ins-dial-at" cx="${at.x}" cy="${at.y}" r="2"></circle>`);
    expect(html).not.toContain("ins-dial-wedge");
  });

  it("shades the whole disc for a step that lets the body stand at any angle, with no reference mark", () => {
    const html = renderToStaticMarkup(<AngleDial step={{ min: 0, max: 360 }} />);
    expect(html).toContain(`<circle class="ins-dial-any" r="${R}"></circle>`);
    expect(html).toContain(`<circle class="ins-dial-rim" r="${R}"></circle>`);
    expect(html).not.toContain("ins-dial-wedge");
    expect(html).not.toContain("ins-dial-line");
    expect(html).not.toContain("ins-dial-ref");
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
