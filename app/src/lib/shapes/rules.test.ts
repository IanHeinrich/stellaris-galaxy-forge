import { describe, expect, it } from "vitest";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../capabilities";
import { DOCUMENT_KINDS } from "../documentKinds";
import { PLACEMENT_RULES, placementPath } from "./rules";

/** A 3.x save's capabilities: the 4.x set with everything that writes whole entries off. */
const OLD_SAVE = { ...SAVE_CAPABILITIES, added_systems: false, bulk_add_systems: false };

describe("a shape's placement rules", () => {
  it("bound a shape by the edge each kind's map draws", () => {
    const save = placementPath(SAVE_CAPABILITIES);
    const scenario = placementPath(SCENARIO_CAPABILITIES);
    expect(save).toBe("rolled");
    expect(scenario).toBe("statements");
    expect(PLACEMENT_RULES[save!].edge).toBe(DOCUMENT_KINDS.save.mapEdge);
    expect(PLACEMENT_RULES[scenario!].edge).toBe(DOCUMENT_KINDS.scenario.mapEdge);
  });

  it("give a 3.x save no path", () => {
    expect(placementPath(OLD_SAVE)).toBeNull();
  });
});
