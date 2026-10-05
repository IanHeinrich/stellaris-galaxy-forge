import { describe, expect, it } from "vitest";
import { PREPARE_ROW_CHOICES } from "../generated/constants";
import type { PrepareRow } from "../generated/PrepareRow";
import type { ScenarioProfile } from "../generated/ScenarioProfile";

import { choiceLabel, lineText, newGameLine, PREPARE_COPY } from "./prepareCopy";

const PROFILES: ScenarioProfile[] = ["plain", "paint_a_galaxy"];
const ROWS = Object.keys(PREPARE_ROW_CHOICES) as PrepareRow[];

/** Every sentence a row's answers say, with the row's count at 3. */
function sentences(profile: ScenarioProfile, row: PrepareRow): string[] {
  const copy = PREPARE_COPY[profile][row];
  return Object.values(copy.answers).flatMap((answers) =>
    lineText(answers.newGame, 3)
      .split(/(?<=\.) /)
      .filter((sentence) => sentence !== ""),
  );
}

describe("the Prepare copy", () => {
  it("names the row's count in its New game line, and words it without one", () => {
    const seats = PREPARE_COPY.plain.empire_seats;
    expect(newGameLine(seats, "keep", 9)).toBe("9 empires starting at these positions.");
    expect(newGameLine(seats, "keep", null)).toBe("Empires starting at these positions.");
    const guardians = PREPARE_COPY.plain.guardians;
    expect(newGameLine(guardians, "keep", 6)).toBe("All 6, even with the Leviathans setting off.");
    expect(newGameLine(guardians, "keep", 1)).toBe(
      "This one, even with the Leviathans setting off.",
    );
    expect(newGameLine(PREPARE_COPY.plain.sol, "plain", 1)).toBe(
      "No Sol from here. Empires that start in Sol build their own where they land. " +
        "With none, the game sometimes adds one.",
    );
  });

  it("calls Keep Keep in every row", () => {
    for (const profile of PROFILES) {
      for (const row of ROWS) expect(choiceLabel(PREPARE_COPY[profile][row], "keep")).toBe("Keep");
    }
  });

  it("repeats no New game sentence across rows, and never says left out", () => {
    for (const profile of PROFILES) {
      const seen = new Map<string, PrepareRow>();
      for (const row of ROWS) {
        for (const sentence of new Set(sentences(profile, row))) {
          expect(seen.get(sentence), `${row}: ${sentence}`).toBeUndefined();
          seen.set(sentence, row);
          expect(sentence).not.toMatch(/left out|^You get/i);
        }
      }
    }
  });

  it("answers all three questions for every choice a Paint a Galaxy map offers", () => {
    for (const row of ROWS) {
      for (const choice of PREPARE_ROW_CHOICES[row]) {
        if (choice === "une_seat" && row !== "sol") continue;
        const answers = PREPARE_COPY.paint_a_galaxy[row].answers[choice];
        expect(answers, `${row} ${choice}`).toBeDefined();
      }
    }
  });
});
