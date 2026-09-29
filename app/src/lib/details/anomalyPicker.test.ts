import { describe, expect, it } from "vitest";
import type { AnomalyChoice } from "../../generated/AnomalyChoice";
import { anomalyPickRows, anomalySections } from "./anomalyPicker";

function choice(key: string, name: string, level: number | null, usual = false): AnomalyChoice {
  return { key, name, level, description: null, usual };
}

const ROWS = anomalyPickRows([
  choice("crashed_ship_asteroid_category", "Crashed Ship", 3, true),
  choice("time_loop_world", "Time Loop", 8),
  choice("origin_asteroid_category", "Unknown Origin", 1, true),
  choice("fx_nameless", "", null),
]);

const labels = (sections: ReturnType<typeof anomalySections>) =>
  sections.map((s) => [s.title, s.rows.map((r) => r.label)]);

describe("the anomaly picker's rows", () => {
  it("are named, by name, with their level, the key standing in for a missing name", () => {
    expect(ROWS.map((r) => [r.label, r.gives])).toEqual([
      ["Crashed Ship", "Level 3"],
      ["fx_nameless", ""],
      ["Time Loop", "Level 8"],
      ["Unknown Origin", "Level 1"],
    ]);
  });

  it("list the usual ones first under All", () => {
    expect(labels(anomalySections(ROWS, "All", ""))).toEqual([
      ["Usual for this planet", ["Crashed Ship", "Unknown Origin"]],
      ["Everything else", ["fx_nameless", "Time Loop"]],
    ]);
  });

  it("narrow to a band of levels and by name or key", () => {
    expect(labels(anomalySections(ROWS, "Low", ""))).toEqual([["", ["Unknown Origin"]]]);
    expect(labels(anomalySections(ROWS, "Middle", ""))).toEqual([["", ["Crashed Ship"]]]);
    expect(labels(anomalySections(ROWS, "High", ""))).toEqual([["", ["Time Loop"]]]);
    expect(labels(anomalySections(ROWS, "All", "loop"))).toEqual([["", ["Time Loop"]]]);
    expect(labels(anomalySections(ROWS, "All", "asteroid_cat"))).toEqual([
      ["Usual for this planet", ["Crashed Ship", "Unknown Origin"]],
    ]);
  });
});
