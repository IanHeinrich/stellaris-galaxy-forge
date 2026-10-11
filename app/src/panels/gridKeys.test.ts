import { describe, expect, it } from "vitest";
import { gridPlace, gridStep, groupedGridStep } from "./gridKeys";

describe("gridStep", () => {
  // Ten tiles four to a row: 0-3, 4-7, 8-9.
  const step = (at: number, key: string) => gridStep(at, key, 10, 4);

  it("moves a tile at a time across rows and a row at a time up and down", () => {
    expect(step(5, "ArrowRight")).toBe(6);
    expect(step(3, "ArrowRight")).toBe(4);
    expect(step(4, "ArrowLeft")).toBe(3);
    expect(step(5, "ArrowDown")).toBe(9);
    expect(step(5, "ArrowUp")).toBe(1);
  });

  it("stops at the ends, and lands on the short last row's last tile", () => {
    expect(step(0, "ArrowLeft")).toBe(0);
    expect(step(9, "ArrowRight")).toBe(9);
    expect(step(7, "ArrowDown")).toBe(9);
    expect(step(9, "ArrowDown")).toBe(9);
    expect(step(2, "ArrowUp")).toBe("above");
    expect(step(6, "Home")).toBe(0);
    expect(step(1, "End")).toBe(9);
  });

  it("leaves other keys alone", () => {
    expect(step(1, "a")).toBeNull();
    expect(step(1, "Enter")).toBeNull();
  });
});

describe("gridPlace", () => {
  const groups = [{ items: [{ key: "a" }, { key: "b" }] }, { items: [{ key: "c" }, { key: "d" }] }];

  it("finds the tab and tile of the current item", () => {
    expect(gridPlace(groups, "d")).toEqual({ group: 1, index: 1 });
  });

  it("opens on the first tile when the current item is not offered", () => {
    expect(gridPlace(groups, "z")).toEqual({ group: 0, index: 0 });
  });
});

describe("groupedGridStep", () => {
  // Two rows of tiles four to a row: a0-a2, then b0-b2.
  const groups = [
    { items: ["a0", "a1", "a2"].map((key) => ({ key })) },
    { items: ["b0", "b1", "b2"].map((key) => ({ key })) },
  ];
  const step = (key: string, pressed: string) => groupedGridStep(groups, key, pressed, 4);

  it("moves up and down to the same column of the group before or after", () => {
    expect(step("a1", "ArrowDown")).toBe("b1");
    expect(step("b2", "ArrowUp")).toBe("a2");
    expect(step("a0", "ArrowUp")).toBeNull();
    expect(step("b1", "ArrowDown")).toBe("b1");
  });

  it("runs left and right on through every group", () => {
    expect(step("a2", "ArrowRight")).toBe("b0");
    expect(step("b0", "ArrowLeft")).toBe("a2");
    expect(step("b2", "End")).toBe("b2");
    expect(step("b2", "Home")).toBe("a0");
  });

  it("moves a row within a group that wraps before it leaves it", () => {
    const tall = [
      { items: ["x0", "x1", "x2", "x3", "x4", "x5"].map((key) => ({ key })) },
      { items: ["y0", "y1"].map((key) => ({ key })) },
    ];
    expect(groupedGridStep(tall, "x1", "ArrowDown", 4)).toBe("x5");
    expect(groupedGridStep(tall, "x5", "ArrowDown", 4)).toBe("y1");
    expect(groupedGridStep(tall, "y1", "ArrowUp", 4)).toBe("x5");
    expect(groupedGridStep(tall, "x3", "ArrowDown", 4)).toBe("x5");
  });
});
