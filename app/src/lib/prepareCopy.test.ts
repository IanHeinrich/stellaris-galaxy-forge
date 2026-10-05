import { describe, expect, it } from "vitest";

import { leftOutLine } from "./prepareCopy";

describe("leftOutLine", () => {
  it("names the rows in lower case except Sol, then the systems cut off", () => {
    expect(leftOutLine(["Sol", "Marauder clans", "Wormhole pairs"], 2)).toBe(
      "Left out of the new game: Sol, marauder clans, wormhole pairs and 2 systems cut off from the rest of the map.",
    );
  });

  it("says nothing when nothing is left out", () => {
    expect(leftOutLine([])).toBeNull();
  });
});
