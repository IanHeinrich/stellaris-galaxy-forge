import { describe, expect, it } from "vitest";
import type { SystemNode } from "../generated/SystemNode";
import { systemNode } from "../test/builders";
import { addedAmong, deleteAddedLabel } from "./addSystem";

describe("the Delete added systems entry", () => {
  const systems = new Map<number, SystemNode>(
    [0, 3, 6, 7, 8].map((id) => [id, systemNode({ id, x: id, added: id > 5 })]),
  );

  it("counts the added systems and the file's own it skips", () => {
    const label = (ids: number[]) => {
      const among = addedAmong(systems, ids);
      return deleteAddedLabel(among.length, ids.length - among.length);
    };
    expect(label([6, 8])).toBe("Delete 2 added systems");
    expect(label([0, 6, 3, 8, 7])).toBe("Delete 3 added systems (skips 2 already in the save)");
    expect(label([7, 0])).toBe("Delete 1 added system (skips 1 already in the save)");
    expect(label([0, 3])).toBeNull();
  });
});
