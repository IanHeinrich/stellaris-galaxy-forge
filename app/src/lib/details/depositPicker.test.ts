import { describe, expect, it } from "vitest";
import type { DepositChoice } from "../../generated/DepositChoice";
import { depositTypeView, modifierLine, resourceAmount } from "../../store/fixtures/planet";
import { addedLine, amountText, depositRows, depositSections } from "./depositPicker";

const choice = (over: Partial<DepositChoice> & { key: string }): DepositChoice => ({
  family: over.key,
  amount: null,
  category: "Features",
  usual: false,
  description: null,
  ...over,
});

const energy = (n: number, over: Partial<DepositChoice> = {}) =>
  choice({ key: `d_energy_${n}`, family: "yields:energy", amount: n, category: "Energy", ...over });

const CHOICES: DepositChoice[] = [
  energy(10, { category: "Special" }),
  energy(1, { usual: true }),
  energy(3),
  choice({ key: "d_rich_mountain", usual: true }),
  choice({ key: "d_alloys_gases", category: "Strategic" }),
  choice({ key: "d_massive_glacier", category: "Blockers" }),
];

const VIEWS = new Map(
  [
    ...[1, 3, 10].map((n) =>
      depositTypeView(`d_energy_${n}`, {
        name: `+${n}`,
        orbital: true,
        yields: [resourceAmount("energy", n, "Energy")],
      }),
    ),
    depositTypeView("d_rich_mountain", {
      name: "Rich Mountains",
      effects: [modifierLine("district_mining_max_add", 1, "+1 Max Mining Districts")],
    }),
    depositTypeView("d_alloys_gases", {
      name: "+5",
      yields: [
        resourceAmount("alloys", 5, "Alloys"),
        resourceAmount("sr_exotic_gases", 3, "Exotic Gases"),
      ],
    }),
    depositTypeView("d_massive_glacier", {
      name: "Massive Glacier",
      blocker: true,
      effects: [modifierLine("planet_max_districts_add", -1, "-1 Max Districts")],
    }),
  ].map((v) => [v.key, v]),
);

describe("the deposit picker's rows", () => {
  const rows = depositRows(CHOICES, VIEWS, "deposits");
  const blockers = depositRows(CHOICES, VIEWS, "blockers");
  const row = (family: string) => rows.find((r) => r.family === family)!;

  it("collapses a family into one row with a button per amount, smallest first", () => {
    expect(rows.map((r) => r.family)).toEqual([
      "d_alloys_gases",
      "yields:energy",
      "d_rich_mountain",
    ]);
    const energyRow = row("yields:energy");
    expect(energyRow.label).toBe("Energy");
    expect(energyRow.gives).toBe("Energy per month");
    expect(energyRow.amounts.map(amountText)).toEqual(["+1", "+3", "+10"]);
    expect(energyRow.category).toBe("Energy");
    expect(energyRow.usual).toBe(true);
  });

  it("spells out what a single type gives, with one Add button", () => {
    expect(row("d_rich_mountain").gives).toBe("+1 Max Mining Districts");
    expect(blockers.map((r) => [r.family, r.gives])).toEqual([
      ["d_massive_glacier", "Blocks 1 district"],
    ]);
    const alloys = row("d_alloys_gases");
    expect(alloys.label).toBe("Alloys and Exotic Gases");
    expect(alloys.gives).toBe("+5 Alloys, +3 Exotic Gases");
    expect(alloys.amounts.map(amountText)).toEqual(["Add"]);
  });

  it("lists what the roll could place here first under All, then everything else", () => {
    const sections = depositSections(rows, "All", "");
    expect(sections.map((s) => [s.title, s.rows.map((r) => r.family)])).toEqual([
      ["Usual for this planet", ["yields:energy", "d_rich_mountain"]],
      ["Everything else", ["d_alloys_gases"]],
    ]);
  });

  it("narrows to a chip's category, and to what the search matches", () => {
    const families = (chip: Parameters<typeof depositSections>[1], query = "") =>
      depositSections(rows, chip, query).flatMap((s) => s.rows.map((r) => r.family));
    expect(families("Usual")).toEqual(["yields:energy", "d_rich_mountain"]);
    expect(families("Special")).toEqual([]);
    expect(families("Strategic")).toEqual(["d_alloys_gases"]);
    expect(families("All", "exotic")).toEqual(["d_alloys_gases"]);
    expect(families("All", "MINING")).toEqual(["d_rich_mountain"]);
    expect(families("All", "strategic")).toEqual(["d_alloys_gases"]);
    expect(families("Food")).toEqual([]);
  });

  it("names a type that gives nothing by leaving what it gives empty, and keeps its description", () => {
    const [placeholder] = depositRows(
      [choice({ key: "d_underground_mining_blocked", description: "Sealed caverns." })],
      new Map([
        [
          "d_underground_mining_blocked",
          depositTypeView("d_underground_mining_blocked", { name: "Teeming Mining Sites" }),
        ],
      ]),
      "deposits",
    );
    expect(placeholder.label).toBe("Teeming Mining Sites");
    expect(placeholder.gives).toBe("");
    expect(placeholder.description).toBe("Sealed caverns.");
  });

  it("says what an add added", () => {
    const energyRow = row("yields:energy");
    expect(addedLine(energyRow, energyRow.amounts[1])).toBe("Added +3 Energy");
    const mountains = row("d_rich_mountain");
    expect(addedLine(mountains, mountains.amounts[0])).toBe("Added Rich Mountains");
  });
});
