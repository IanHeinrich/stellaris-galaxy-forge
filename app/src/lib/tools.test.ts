import { describe, expect, it } from "vitest";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES, supports } from "./capabilities";
import { toolRequires } from "./tools";

describe("the Shape tool", () => {
  it("is offered on a scenario and a 4.x save, and not on a 3.x save", () => {
    const shape = toolRequires("shape");
    expect(supports(SCENARIO_CAPABILITIES, shape)).toBe(true);
    expect(supports(SAVE_CAPABILITIES, shape)).toBe(true);
    const oldSave = { ...SAVE_CAPABILITIES, added_systems: false, bulk_add_systems: false };
    expect(supports(oldSave, shape)).toBe(false);
  });
});
