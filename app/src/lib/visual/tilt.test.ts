import { describe, expect, it } from "vitest";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../capabilities";
import { GAME_DEFAULT_TILT, settledTilt, shownTilt, tiltAvailable } from "./tilt";

describe("the tilt view", () => {
  it("leans a save's galaxy whatever layers are on, and never a scenario's", () => {
    expect(tiltAvailable(SAVE_CAPABILITIES)).toBe(true);
    expect(shownTilt(30, SAVE_CAPABILITIES)).toBe(30);
    expect(tiltAvailable(SCENARIO_CAPABILITIES)).toBe(false);
    expect(shownTilt(30, SCENARIO_CAPABILITIES)).toBe(0);
  });

  it("settles on the game's own camera angle when let go close to it", () => {
    expect(settledTilt(GAME_DEFAULT_TILT + 1)).toBe(GAME_DEFAULT_TILT);
    expect(settledTilt(GAME_DEFAULT_TILT - 1)).toBe(GAME_DEFAULT_TILT);
    expect(settledTilt(GAME_DEFAULT_TILT + 2)).toBe(GAME_DEFAULT_TILT + 2);
    expect(settledTilt(0)).toBe(0);
  });
});
