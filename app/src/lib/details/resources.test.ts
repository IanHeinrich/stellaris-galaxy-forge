import { describe, expect, it } from "vitest";
import { details } from "./fixture";
import {
  formatAmount,
  resourceChips,
  resourceLabel,
  resourceRows,
  resourceStride,
} from "./resources";

describe("resourceRows", () => {
  it("orders energy, minerals, research and maps heuristic names onto the game's icons", () => {
    const rows = resourceRows(
      details({
        resources: [
          { resource: "engineering", amount: 5 },
          { resource: "minerals", amount: 13 },
          { resource: "energy", amount: 13 },
        ],
      }),
    );
    expect(rows.map((r) => r.resource)).toEqual(["energy", "minerals", "engineering_research"]);
    expect(rows[2].sprite).toBe("sprite:GFX_resource_engineering_research");
    expect(rows[0].sprite).toBe("sprite:GFX_resource_energy");
  });

  it("prefers the sprite the game's resource definitions name, under the game's own id", () => {
    const icons = new Map([
      ["energy", "GFX_energy"],
      ["trade", "GFX_text_trade_value"],
    ]);
    const d = details({
      resources: [
        { resource: "trade_value", amount: 3 },
        { resource: "energy", amount: 1 },
        { resource: "minerals", amount: 2 },
      ],
    });
    const rows = resourceRows(d, icons);
    expect(rows.map((r) => r.resource)).toEqual(["energy", "minerals", "trade"]);
    expect(rows.map((r) => r.sprite)).toEqual([
      "sprite:GFX_energy",
      "sprite:GFX_resource_minerals",
      "sprite:GFX_text_trade_value",
    ]);
  });

  it("renders text chips when icons are unavailable", () => {
    const d = details({
      resources: [
        { resource: "engineering", amount: 5 },
        { resource: "energy", amount: 13 },
        { resource: "minerals", amount: 13 },
      ],
    });
    expect(resourceChips(d)).toBe("E 13 · M 13 · Eng 5");
  });
});

describe("formatAmount", () => {
  it.each([
    [13, "13"],
    [2.5, "2.5"],
  ])("keeps one decimal and drops the fraction of a whole number: %s", (n, text) => {
    expect(formatAmount(n)).toBe(text);
  });
});

describe("resourceStride / resourceLabel", () => {
  it("keeps the full cell up to three resources and tightens to 12 px at eight", () => {
    expect(resourceStride(1)).toBe(17);
    expect(resourceStride(3)).toBe(17);
    expect(resourceStride(5)).toBeCloseTo(15);
    expect(resourceStride(8)).toBe(12);
    expect(resourceStride(12)).toBe(12);
  });

  it.each([
    ["physics_research", "Physics Research"],
    ["sr_dark_matter", "Dark Matter"],
  ])("humanises a resource id: %s", (resource, label) => {
    expect(resourceLabel(resource)).toBe(label);
  });
});
