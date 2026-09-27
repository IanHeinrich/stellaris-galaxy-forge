import { describe, expect, it } from "vitest";
import { gridPlace, gridStep, groupItems } from "./gridKeys";

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

describe("groupItems", () => {
  it("lists the groups without a section first, then each section's under its heading", () => {
    const items = groupItems([
      { key: "stars", label: "stars", section: "From mods" },
      { key: "pointy", label: "pointy" },
      { key: "blocky", label: "blocky" },
    ]);
    expect(items.map((i) => [i.key, i.group])).toEqual([
      ["pointy", undefined],
      ["blocky", undefined],
      ["stars", "From mods"],
    ]);
  });
});
