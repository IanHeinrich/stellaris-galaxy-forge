import { describe, expect, it } from "vitest";
import {
  byLabel,
  chipLabel,
  effectSummary,
  PICKER_CARD_WIDTH,
  pickerCardPlace,
  pickerSections,
  searchText,
  type PickRow,
} from "./picker";

interface Row extends PickRow {
  kind: string;
}

const row = (label: string, kind: string, usual = false): Row => ({
  label,
  kind,
  usual,
  search: searchText([label, kind]),
});

const ROWS = byLabel([
  row("Toxic Spill", "Negative"),
  row("Rich Mountains", "Features", true),
  row("Energy", "Energy", true),
  row("Alloys", "Strategic"),
]);

const sections = (rows: readonly Row[], chip: string, query = "", restAlone = "Everything else") =>
  pickerSections(rows, chip, query, (r, each) => r.kind === each, restAlone).map((s) => [
    s.title,
    s.rows.map((r) => r.label),
  ]);

describe("a picker's sections", () => {
  it("lists rows by name, the usual ones first under All, then everything else", () => {
    expect(sections(ROWS, "All")).toEqual([
      ["Usual for this planet", ["Energy", "Rich Mountains"]],
      ["Everything else", ["Alloys", "Toxic Spill"]],
    ]);
  });

  it("titles the rest as the picker asks when none is usual", () => {
    const plain = ROWS.filter((r) => !r.usual);
    expect(sections(plain, "All")).toEqual([["Everything else", ["Alloys", "Toxic Spill"]]]);
    expect(sections(plain, "All", "", "")).toEqual([["", ["Alloys", "Toxic Spill"]]]);
  });

  it("narrows to the usual rows, a chip of the picker's own, and what the search matches", () => {
    expect(sections(ROWS, "Usual")).toEqual([["", ["Energy", "Rich Mountains"]]]);
    expect(sections(ROWS, "Strategic")).toEqual([["", ["Alloys"]]]);
    expect(sections(ROWS, "All", " SPILL ")).toEqual([["Everything else", ["Toxic Spill"]]]);
    expect(sections(ROWS, "Features", "energy")).toEqual([]);
    expect(sections(ROWS, "All", "no such thing")).toEqual([]);
  });
});

describe("a picker row's effects", () => {
  it("names the first two and counts the rest", () => {
    expect(effectSummary(["+5 Alloys", "+3 Exotic Gases", "+1 Unity", "-1 Max Districts"])).toEqual(
      { shown: "+5 Alloys, +3 Exotic Gases", more: "+2 more" },
    );
  });

  it("counts nothing more for two or one, and shows nothing for none", () => {
    expect(effectSummary(["+5 Alloys", "+3 Exotic Gases"])).toEqual({
      shown: "+5 Alloys, +3 Exotic Gases",
      more: null,
    });
    expect(effectSummary(["Energy per month"])).toEqual({ shown: "Energy per month", more: null });
    expect(effectSummary([])).toEqual({ shown: "", more: null });
  });

  it("calls a category by its chip's label, or by itself without one", () => {
    const chips = [{ chip: "Feature", label: "Features" }];
    expect(chipLabel(chips, "Feature")).toBe("Features");
    expect(chipLabel<string>(chips, "Blockers")).toBe("Blockers");
  });
});

describe("where a picker's side card goes", () => {
  /** A picker in a dock 360 wide on the right of a window 1200 wide. */
  const PICKER = { left: 850, top: 100, right: 1190, bottom: 620 };

  it("sits left of the picker, level with the row", () => {
    expect(pickerCardPlace(PICKER, 240, 180, 800)).toEqual({
      left: 850 - 6 - PICKER_CARD_WIDTH,
      top: 240,
    });
  });

  it("moves up to stay above the window's bottom edge, and never above its top", () => {
    expect(pickerCardPlace(PICKER, 700, 180, 800)?.top).toBe(800 - 8 - 180);
    expect(pickerCardPlace(PICKER, 2, 180, 800)?.top).toBe(8);
    expect(pickerCardPlace(PICKER, 240, 900, 800)?.top).toBe(8);
  });

  it("goes under the list where the window has no room left of the picker", () => {
    const narrow = { left: 200, top: 100, right: 540, bottom: 620 };
    expect(pickerCardPlace(narrow, 240, 180, 800)).toBeNull();
    const justFits = { ...narrow, left: 8 + PICKER_CARD_WIDTH + 6 };
    expect(pickerCardPlace(justFits, 240, 180, 800)?.left).toBe(8);
  });
});
