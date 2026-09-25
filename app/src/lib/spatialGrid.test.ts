import { describe, expect, it } from "vitest";
import { placedNode as node } from "../test/builders";
import { CELL_SIZE, SpatialGrid } from "./spatialGrid";

describe("SpatialGrid", () => {
  it("finds the nearest system across cell boundaries and respects maxDist", () => {
    const grid = new SpatialGrid();
    const a = node(1, CELL_SIZE - 1, 0);
    const b = node(2, CELL_SIZE + 4, 0);
    const c = node(3, -CELL_SIZE * 3, 0);
    grid.build([a, b, c]);

    expect(grid.nearestSystem(CELL_SIZE + 1, 0, 10)?.id).toBe(1);
    expect(grid.nearestSystem(CELL_SIZE + 3, 0, 10)?.id).toBe(2);
    expect(grid.nearestSystem(CELL_SIZE + 3, 20, 10)).toBeNull();
    expect(grid.nearestSystem(CELL_SIZE + 3, 20, 25)?.id).toBe(2);
    expect(grid.nearestSystem(-CELL_SIZE * 3, -CELL_SIZE * 2.5, CELL_SIZE * 3)?.id).toBe(3);
  });

  it("update moves a node between cells", () => {
    const grid = new SpatialGrid();
    const a = node(1, 0, 0);
    grid.build([a, node(2, 100, 100)]);
    expect(grid.nearestSystem(1, 1, 5)?.id).toBe(1);

    grid.update(node(1, 200, -200));
    expect(grid.nearestSystem(1, 1, 5)).toBeNull();
    expect(grid.nearestSystem(201, -199, 5)?.id).toBe(1);
    expect(grid.nearestSystem(100, 100, 1)?.id).toBe(2);
  });

  it("forEachIn visits exactly the systems inside the box", () => {
    const grid = new SpatialGrid();
    grid.build([
      node(1, 0, 0),
      node(2, CELL_SIZE - 1, CELL_SIZE - 1),
      node(3, CELL_SIZE + 1, 0),
      node(4, -CELL_SIZE, -CELL_SIZE * 4),
      node(5, CELL_SIZE * 10, CELL_SIZE * 10),
    ]);
    const seen: number[] = [];
    grid.forEachIn(-CELL_SIZE, -CELL_SIZE, CELL_SIZE, CELL_SIZE, (s) => seen.push(s.id));
    expect(seen.sort()).toEqual([1, 2]);

    seen.length = 0;
    grid.forEachIn(-1e6, -1e6, 1e6, 1e6, (s) => seen.push(s.id));
    expect(seen.length).toBe(5);

    seen.length = 0;
    grid.forEachIn(CELL_SIZE * 20, CELL_SIZE * 20, CELL_SIZE * 30, CELL_SIZE * 30, (s) =>
      seen.push(s.id),
    );
    expect(seen).toEqual([]);
  });
});
