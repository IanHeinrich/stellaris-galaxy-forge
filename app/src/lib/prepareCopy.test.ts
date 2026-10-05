import { describe, expect, it } from "vitest";
import { PREPARE_ROW_CHOICES } from "../generated/constants";
import type { PrepareRow } from "../generated/PrepareRow";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { offeredChoices } from "../store/prepareStore";

import {
  choiceLabel,
  choiceText,
  lineText,
  PREPARE_COPY,
  PRESET_ANSWERS,
  rowDisabledReason,
  type Answers,
} from "./prepareCopy";

const PROFILES: ScenarioProfile[] = ["plain", "paint_a_galaxy"];
const ROWS = Object.keys(PREPARE_ROW_CHOICES) as PrepareRow[];

/** Every line a row's choices say, with the row's count at 3. */
function lines(profile: ScenarioProfile, row: PrepareRow): string[] {
  const answers = Object.values(PREPARE_COPY[profile][row].answers) as Answers[];
  return answers.map((answer) => lineText(answer.text, 3));
}

/** Rows whose Keep line is the same sentence by design: both say only where they spawn. */
const SAME_KEEP: readonly PrepareRow[] = ["guardians", "enclaves"];

describe("the Prepare copy", () => {
  it("names the row's count where it has one, and words it without one", () => {
    const positions = PREPARE_COPY.plain.empire_seats;
    expect(choiceText(positions, "keep", 9)).toBe("Empires start at these 9 positions.");
    expect(choiceText(positions, "keep", null)).toBe("Empires start at these positions.");
    expect(choiceText(positions, "keep", 1)).toBe("Empires start at this position.");
    expect(choiceText(PREPARE_COPY.plain.guardians, "keep", 6)).toBe(
      "These 6 spawn where they are now.",
    );
    expect(choiceText(PREPARE_COPY.plain.guardians, "keep", 1)).toBe(
      "This one spawns where it is now.",
    );
  });

  it("calls Keep Keep as is in every row", () => {
    for (const profile of PROFILES) {
      for (const row of ROWS) {
        expect(choiceLabel(PREPARE_COPY[profile][row], "keep")).toBe("Keep as is");
      }
    }
  });

  it("never says You get, left out or point at, and repeats no line across rows", () => {
    for (const profile of PROFILES) {
      const seen = new Map<string, PrepareRow>();
      for (const row of ROWS) {
        for (const line of new Set(lines(profile, row))) {
          expect(line).not.toMatch(/you get|left out|point at/i);
          const earlier = seen.get(line);
          if (earlier !== undefined && SAME_KEEP.includes(row) && SAME_KEEP.includes(earlier)) {
            continue;
          }
          expect(earlier, `${row}: ${line}`).toBeUndefined();
          seen.set(line, row);
        }
      }
    }
    for (const preset of Object.values(PRESET_ANSWERS)) expect(preset.text).not.toMatch(/you get/i);
  });

  it("gives every choice a row offers, on either kind of map, a tag and a line", () => {
    for (const profile of PROFILES) {
      for (const row of ROWS) {
        if (rowDisabledReason(row, profile) !== undefined) continue;
        for (const choice of offeredChoices(row, profile)) {
          const answers = PREPARE_COPY[profile][row].answers[choice];
          expect(answers?.placer, `${profile} ${row} ${choice}`).toBeDefined();
          expect(choiceText(PREPARE_COPY[profile][row], choice, 3)).not.toBe("");
        }
      }
    }
  });
});
