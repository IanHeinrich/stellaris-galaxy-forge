import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../lib/geometry/geometry";
import { Camera } from "./Camera";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

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
