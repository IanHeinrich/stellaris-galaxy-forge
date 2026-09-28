import { describe, expect, it } from "vitest";
import { byLabel, pickerSections, searchText, type PickRow } from "./picker";

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
