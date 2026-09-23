import { describe, expect, it } from "vitest";
import { releaseHeadline } from "./releaseNotes";

describe("the headline of a release's notes", () => {
  it("is the first entry, on one line and without its markup", () => {
    const notes = "### Added\n\n- A system's `stars` can be edited\n  in a save.\n- Another.";
    expect(releaseHeadline(notes)).toBe("A system's stars can be edited in a save.");
  });

  it("is the first paragraph of notes with no list, and empty for no notes", () => {
    expect(releaseHeadline("Lanes keep their length\nNebulae move")).toBe(
      "Lanes keep their length Nebulae move",
    );
    expect(releaseHeadline("")).toBe("");
  });
});
