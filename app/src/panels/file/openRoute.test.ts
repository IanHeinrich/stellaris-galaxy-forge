import { describe, expect, it } from "vitest";
import { openRoute } from "./openRoute";

describe("what activating a row does", () => {
  it("asks how to open a save, opens a scenario file at once, and skips the question for the scenario shortcut", () => {
    expect(openRoute("C:/saves/one.sav", false)).toBe("ask");
    expect(openRoute("C:/saves/one.sav", true)).toBe("scenario");
    expect(openRoute("C:/mod/map/setup_scenarios/big.txt", false)).toBe("save");
  });
});
