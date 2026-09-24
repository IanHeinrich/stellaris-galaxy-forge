import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBMENU_CLOSE_MS, SubmenuAim, aimsAt, inTriangle, placeBeside } from "./menuAim";

/** A submenu to the right of an entry that the pointer left at (100, 50). */
const MENU = { left: 110, top: 20, right: 250, bottom: 220 };
const LEFT_AT = { x: 100, y: 50 };

describe("the pointer's aim at a submenu", () => {
  it("counts a point inside the triangle, whichever way it winds", () => {
    const [a, b, c] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(inTriangle({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(inTriangle({ x: 2, y: 2 }, a, c, b)).toBe(true);
    expect(inTriangle({ x: 8, y: 8 }, a, b, c)).toBe(false);
  });

  it("heads for the submenu down and across towards a lower item, not away from it", () => {
    expect(aimsAt({ x: 104, y: 70 }, LEFT_AT, MENU)).toBe(true);
    expect(aimsAt({ x: 96, y: 70 }, LEFT_AT, MENU)).toBe(false);
    expect(aimsAt({ x: 104, y: 10 }, LEFT_AT, MENU)).toBe(false);
  });

  it("reads a submenu on the left from its right side", () => {
    const left = { left: -50, top: 20, right: 90, bottom: 220 };
    expect(aimsAt({ x: 95, y: 70 }, LEFT_AT, left)).toBe(true);
    expect(aimsAt({ x: 105, y: 70 }, LEFT_AT, left)).toBe(false);
  });
});

describe("when a submenu opens and closes", () => {
  let open = false;
  let aim: SubmenuAim;

  beforeEach(() => {
    vi.useFakeTimers();
    open = false;
    aim = new SubmenuAim((next) => (open = next));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens as the pointer comes onto the entry, and not on a disabled one", () => {
    aim.enter(false);
    expect(open).toBe(false);
    aim.enter(true);
    expect(open).toBe(true);
  });

  it("closes a moment after the pointer leaves both", () => {
    aim.enter(true);
    aim.leave(LEFT_AT);
    vi.advanceTimersByTime(SUBMENU_CLOSE_MS - 1);
    expect(open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(open).toBe(false);
  });

  it("stays open when the pointer reaches the submenu within the delay", () => {
    aim.enter(true);
    aim.leave(LEFT_AT);
    vi.advanceTimersByTime(SUBMENU_CLOSE_MS - 50);
    aim.enter(true);
    vi.advanceTimersByTime(SUBMENU_CLOSE_MS * 4);
    expect(open).toBe(true);
    expect(aim.closing).toBe(false);
  });

  it("waits longer while the pointer travels on towards the submenu, and closes once it stops", () => {
    aim.enter(true);
    aim.leave(LEFT_AT);
    for (let step = 1; step <= 5; step++) {
      vi.advanceTimersByTime(SUBMENU_CLOSE_MS - 50);
      aim.move({ x: 100 + step, y: 50 + step * 10 }, MENU);
    }
    expect(open).toBe(true);
    vi.advanceTimersByTime(SUBMENU_CLOSE_MS);
    expect(open).toBe(false);
  });

  it("does not wait for a pointer heading elsewhere", () => {
    aim.enter(true);
    aim.leave(LEFT_AT);
    vi.advanceTimersByTime(SUBMENU_CLOSE_MS - 50);
    aim.move({ x: 60, y: 90 }, MENU);
    vi.advanceTimersByTime(50);
    expect(open).toBe(false);
  });

  it("closes at once when asked, and a move after that opens nothing", () => {
    aim.enter(true);
    aim.closeNow();
    expect(open).toBe(false);
    aim.move({ x: 104, y: 70 }, MENU);
    vi.advanceTimersByTime(SUBMENU_CLOSE_MS);
    expect(open).toBe(false);
  });
});

describe("where a submenu or card goes beside its anchor", () => {
  const anchor = { left: 300, top: 100, right: 400, bottom: 122 };
  const size = { width: 200, height: 300 };

  it("opens on the right, over the anchor's edge by the overlap", () => {
    expect(placeBeside(anchor, 93, size, { width: 1000, height: 800 }, 2)).toEqual({
      left: 398,
      top: 93,
      side: "right",
    });
  });

  it("opens on the left near the right edge, still over the anchor's edge", () => {
    expect(placeBeside(anchor, 93, size, { width: 560, height: 800 }, 2)).toEqual({
      left: 102,
      top: 93,
      side: "left",
    });
  });

  it("keeps opening left under a parent that opened left, though the right has room", () => {
    const wide = { width: 1000, height: 800 };
    expect(placeBeside(anchor, 93, size, wide, 2, "left")).toEqual({
      left: 102,
      top: 93,
      side: "left",
    });
  });

  it("goes right under a parent that opened left when the left has no room", () => {
    const near = { left: 150, top: 100, right: 250, bottom: 122 };
    expect(placeBeside(near, 93, size, { width: 1000, height: 800 }, 2, "left").side).toBe("right");
  });

  it("moves up to stay above the bottom edge", () => {
    expect(placeBeside(anchor, 93, size, { width: 1000, height: 350 }).top).toBe(42);
  });
});
