import { describe, expect, it } from "vitest";
import { effectText } from "./planetEdits";

describe("a planet page's words", () => {
  it("words a lost district as what a blocker blocks, and any other effect as the game does", () => {
    const line = (key: string, value: number, text: string) => ({ key, value, text });
    expect(effectText(line("planet_max_districts_add", -1, "-1 Max Districts"))).toBe(
      "Blocks 1 district",
    );
    expect(effectText(line("planet_max_districts_add", -2, "-2 Max Districts"))).toBe(
      "Blocks 2 districts",
    );
    expect(effectText(line("district_mining_max_add", 2, "+2 Max Mining Districts"))).toBe(
      "+2 Max Mining Districts",
    );
  });
});
