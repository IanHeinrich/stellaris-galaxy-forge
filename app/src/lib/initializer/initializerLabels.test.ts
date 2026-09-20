import { describe, expect, it } from "vitest";
import {
  dimmedByInitializer,
  initializerCounts,
  initializerLabel,
  legendGroups,
} from "./initializerLabels";

const SYSTEMS = [
  { initializer: "sol_system_initializer" },
  { initializer: "" },
  { initializer: "guardian_dragon" },
  { initializer: "" },
  { initializer: "guardian_dragon" },
  { initializer: "" },
  { initializer: "alpha_init" },
];

describe("initializerCounts", () => {
  it("counts each distinct key, most used first, ties broken by label", () => {
    expect(initializerCounts(SYSTEMS)).toEqual([
      { key: "", count: 3 },
      { key: "guardian_dragon", count: 2 },
      { key: "alpha_init", count: 1 },
      { key: "sol_system_initializer", count: 1 },
    ]);
  });

  it("is empty for a document with no systems", () => {
    expect(initializerCounts([])).toEqual([]);
  });
});

describe("initializerLabel", () => {
  it("calls the empty key random and leaves any other alone", () => {
    expect(initializerLabel("")).toBe("random");
    expect(initializerLabel("guardian_dragon")).toBe("guardian_dragon");
  });
});

describe("dimmedByInitializer", () => {
  it("dims only a system whose own key is hidden", () => {
    const hidden = new Set(["guardian_dragon", ""]);
    expect(dimmedByInitializer({ initializer: "guardian_dragon" }, hidden)).toBe(true);
    expect(dimmedByInitializer({ initializer: "" }, hidden)).toBe(true);
    expect(dimmedByInitializer({ initializer: "alpha_init" }, hidden)).toBe(false);
  });

  it("dims nothing while the legend hides nothing", () => {
    expect(dimmedByInitializer({ initializer: "" }, new Set())).toBe(false);
  });
});

describe("legendGroups", () => {
  const GROUPS = [
    { id: "leviathan", label: "Leviathans", entries: [{ name: "guardian_dragon" }] },
    { id: "empire", label: "Empire spawn", entries: [{ name: "sol_system_initializer" }] },
    { id: "origin", label: "Origin", entries: [{ name: "unused_initializer" }] },
  ];

  it("lists the used keys under the groups the game data puts them in", () => {
    expect(legendGroups(initializerCounts(SYSTEMS), GROUPS)).toEqual([
      { id: "leviathan", label: "Leviathans", rows: [{ key: "guardian_dragon", count: 2 }] },
      {
        id: "empire",
        label: "Empire spawn",
        rows: [{ key: "sol_system_initializer", count: 1 }],
      },
      { id: "other", label: "Other", rows: [{ key: "alpha_init", count: 1 }] },
    ]);
  });

  it("leaves the random key to the legend and puts everything under Other without game data", () => {
    expect(legendGroups(initializerCounts(SYSTEMS), [])).toEqual([
      {
        id: "other",
        label: "Other",
        rows: [
          { key: "guardian_dragon", count: 2 },
          { key: "alpha_init", count: 1 },
          { key: "sol_system_initializer", count: 1 },
        ],
      },
    ]);
  });

  it("is empty for a document with no initializers at all", () => {
    expect(legendGroups([], GROUPS)).toEqual([]);
  });
});
