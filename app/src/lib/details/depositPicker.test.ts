import { describe, expect, it } from "vitest";
import type { DepositChoice } from "../../generated/DepositChoice";
import { depositTypeView, modifierLine, resourceAmount } from "../../store/fixtures/planet";
import {
  addedLine,
  amountText,
  blockerChips,
  depositRows,
  depositSections,
  describes,
} from "./depositPicker";

const choice = (over: Partial<DepositChoice> & { key: string }): DepositChoice => ({
  family: over.key,
  amount: null,
  category: "Features",
  usual: false,
  description: null,
  event_only: false,
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

  it("gives each amount its own hover text, and a family row none from its first type", () => {
    const [energyRow] = depositRows(
      [energy(1, { description: "+1" }), energy(5, { description: "A rich seam of energy." })],
      VIEWS,
      "deposits",
    );
    expect(energyRow.description).toBeNull();
    expect(energyRow.amounts.map((a) => a.title)).toEqual([
      "+1 Energy",
      "+5 Energy. A rich seam of energy.",
    ]);
    expect(describes("+5")).toBeNull();
    expect(describes(" 0.1 ")).toBeNull();
    expect(describes("Sealed caverns.")).toBe("Sealed caverns.");
  });

  it("says what an add added", () => {
    const energyRow = row("yields:energy");
    expect(addedLine(energyRow, energyRow.amounts[1])).toBe("Added +3 Energy");
    const mountains = row("d_rich_mountain");
    expect(addedLine(mountains, mountains.amounts[0])).toBe("Added Rich Mountains");
  });
});

describe("the blocker picker's chips", () => {
  const blocker = (key: string, over: Partial<DepositChoice> = {}) =>
    choice({ key, category: "Blockers", ...over });
  const clearing = (techs: { key: string; name: string }[]) => ({ cost: [], days: 180, techs });
  const WILDLIFE = { key: "tech_wildlife", name: "Dangerous Wildlife Removal" };
  const CLIMATE = { key: "tech_climate", name: "Climate Control Network" };
  const loses = (n: number) => modifierLine("planet_max_districts_add", -n, `-${n} Max Districts`);
  const views = new Map(
    [
      depositTypeView("d_wildlife", {
        name: "Dangerous Wildlife",
        blocker: true,
        effects: [loses(1)],
        clearing: clearing([WILDLIFE]),
      }),
      depositTypeView("d_glacier", {
        name: "Massive Glacier",
        blocker: true,
        effects: [loses(2)],
        clearing: clearing([CLIMATE, WILDLIFE]),
      }),
      depositTypeView("d_bog", {
        name: "Bog",
        blocker: true,
        effects: [loses(1)],
        clearing: clearing([]),
      }),
      depositTypeView("d_rift", {
        name: "Shroud Rift",
        blocker: true,
        effects: [loses(1), modifierLine("pop_happiness", -0.1, "-10% Stability")],
      }),
      depositTypeView("d_pods", { name: "Stasis Pods", blocker: true, effects: [loses(1)] }),
    ].map((v) => [v.key, v]),
  );
  const rows = depositRows(
    [
      blocker("d_wildlife", { usual: true }),
      blocker("d_glacier"),
      blocker("d_bog"),
      blocker("d_rift"),
      blocker("d_pods", { event_only: true }),
    ],
    views,
    "blockers",
  );
  const families = (chip: Parameters<typeof depositSections>[1]) =>
    depositSections(rows, chip, "").flatMap((s) => s.rows.map((r) => r.family));

  it("offers one chip per clearing tech by name, then no tech, can't be cleared and Special", () => {
    expect(blockerChips(rows).map((c) => c.label)).toEqual([
      "All",
      "Usual here",
      "Climate Control Network",
      "Dangerous Wildlife Removal",
      "No tech needed",
      "Can't be cleared",
      "Special",
    ]);
  });

  it("keeps under a tech's chip every blocker that tech clears", () => {
    expect(families("tech:tech_wildlife")).toEqual(["d_wildlife", "d_glacier"]);
    expect(families("tech:tech_climate")).toEqual(["d_glacier"]);
    expect(families("NoTech")).toEqual(["d_bog"]);
    expect(families("Uncleared")).toEqual(["d_rift", "d_pods"]);
    expect(families("Usual")).toEqual(["d_wildlife"]);
  });

  it("calls Special a blocker that does more than take districts away, or that only events place", () => {
    expect(families("Special")).toEqual(["d_rift", "d_pods"]);
  });
});
