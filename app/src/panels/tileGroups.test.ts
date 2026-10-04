import { describe, expect, it } from "vitest";
import { groupItems } from "./tileGroups";

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
