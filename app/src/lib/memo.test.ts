import { describe, expect, it, vi } from "vitest";
import { lastOf } from "./memo";

describe("lastOf", () => {
  it("keeps the answer while every input is the same, and computes again from the last when one changes", () => {
    const memo = lastOf<string[]>();
    const a = {};
    const compute = vi.fn((previous: string[] | null) => [...(previous ?? []), "next"]);

    const first = memo([a, 1], compute);
    expect(memo([a, 1], compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);

    expect(memo([{}, 1], compute)).toEqual(["next", "next"]);
    expect(memo([{}, 1, 2], compute)).toHaveLength(3);
    expect(compute.mock.calls[0][0]).toBeNull();
  });
});
