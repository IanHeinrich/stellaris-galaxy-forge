import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../lib/geometry/geometry";
import { seeded } from "../lib/random";
import { Camera } from "./Camera";
import { FLAT_TILT, LIFT_SCALE, liftedY } from "./tilt";

describe("Camera", () => {
  it("applies the axis signs once between world and screen and round-trips", () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.x = 10;
    cam.y = 20;
    cam.scale = 2;
    const s = cam.worldToScreen(12, 30);
    expect(s.x).toBeCloseTo(400 + SAVE_X_SIGN * 2 * 2);
    expect(s.y).toBeCloseTo(300 + SAVE_Y_SIGN * 10 * 2);
    const w = cam.screenToWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(12);
    expect(w.y).toBeCloseTo(30);

    const t = cam.worldTransform();
    expect(t.x + 12 * t.scaleX).toBeCloseTo(s.x);
    expect(t.y + 30 * t.scaleY).toBeCloseTo(s.y);
    const cs = cam.childScale(3);
    expect(cs.x * t.scaleX).toBeCloseTo(3);
    expect(cs.y * t.scaleY).toBeCloseTo(3);
  });

  it("zoomAt keeps the world point under the cursor fixed", () => {
    const rnd = seeded(7);
    const cam = new Camera();
    cam.setViewport(1024, 768);
    cam.fit(500);
    for (let i = 0; i < 200; i++) {
      const screen = { x: rnd() * 1024, y: rnd() * 768 };
      const factor = Math.pow(1.1, Math.floor(rnd() * 21) - 10);
      const before = cam.screenToWorld(screen.x, screen.y);
      cam.zoomAt(screen, factor);
      const after = cam.screenToWorld(screen.x, screen.y);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expect(cam.scale).toBeGreaterThanOrEqual(cam.minScale);
      expect(cam.scale).toBeLessThanOrEqual(cam.maxScale);
    }
  });

  it("fit puts the whole galaxy inside the viewport with a margin", () => {
    const cam = new Camera();
    cam.fit(500, 1200, 700);
    expect(cam.scale).toBeCloseTo(700 / (2.2 * 500));
    for (const [x, y] of [
      [500, 0],
      [-500, 0],
      [0, 500],
      [0, -500],
      [353, 353],
    ]) {
      const s = cam.worldToScreen(x, y);
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1200);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(700);
    }
  });

  it("panBy follows the pointer 1:1", () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.fit(100);
    const under = cam.screenToWorld(100, 100);
    cam.panBy(50, -30);
    const now = cam.screenToWorld(150, 70);
    expect(now.x).toBeCloseTo(under.x);
    expect(now.y).toBeCloseTo(under.y);
  });

  it("easeTo reaches its target and stops animating", () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.fit(100);
    cam.easeTo(40, -20, 5, 200);
    expect(cam.animating).toBe(true);
    for (let i = 0; i < 20; i++) cam.update(16);
    expect(cam.animating).toBe(false);
    expect(cam.x).toBeCloseTo(40);
    expect(cam.y).toBeCloseTo(-20);
    expect(cam.scale).toBeCloseTo(5);
  });
});

describe("the tilted camera", () => {
  function tilted(degrees: number): Camera {
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.x = 10;
    cam.y = 20;
    cam.scale = 2;
    cam.setTilt(degrees);
    return cam;
  }

  it("draws exactly as before at 0°", () => {
    const flat = tilted(0);
    expect(flat.tilt).toBe(FLAT_TILT);
    expect(flat.worldToScreen(12, 30).y).toBe(300 + SAVE_Y_SIGN * 10 * 2);
    expect(liftedY(30, 80, flat.tilt)).toBe(30);
  });

  it("squashes the plane about the centre of view and leaves x alone", () => {
    const cam = tilted(60);
    const s = cam.worldToScreen(12, 30);
    expect(s.x).toBeCloseTo(400 + SAVE_X_SIGN * 2 * 2);
    expect(s.y).toBeCloseTo(300 + SAVE_Y_SIGN * 10 * 2 * 0.5);
    expect(cam.worldToScreen(10, 20).y).toBeCloseTo(300);
    const w = cam.screenToWorld(s.x, s.y);
    expect(w.y).toBeCloseTo(30);

    const t = cam.worldTransform();
    expect(t.y + 30 * t.scaleY).toBeCloseTo(s.y);
    const cs = cam.childScale(3);
    expect(cs.y * t.scaleY).toBeCloseTo(3);
  });

  it("lifts a system above the plane by its height times the sine, on screen", () => {
    const cam = tilted(30);
    const plane = cam.worldToScreen(12, 30);
    const above = cam.worldToScreen(12, liftedY(30, 40, cam.tilt));
    const below = cam.worldToScreen(12, liftedY(30, -40, cam.tilt));
    const rise = 40 * LIFT_SCALE * Math.sin(Math.PI / 6) * cam.scale;
    expect(above.x).toBeCloseTo(plane.x);
    expect(plane.y - above.y).toBeCloseTo(rise);
    expect(below.y - plane.y).toBeCloseTo(rise);
  });

  it("keeps the tilt between flat and its steepest", () => {
    expect(tilted(90).tilt.degrees).toBe(60);
    expect(tilted(-5).tilt).toBe(FLAT_TILT);
  });
});
