import { describe, expect, it } from "vitest";
import { parseReleaseNotes, releaseHeadline } from "./releaseNotes";

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

describe("a release's notes as blocks", () => {
  it("reads headings, lists and paragraphs, with code, bold and link spans", () => {
    const notes = [
      "## [0.13.0] - 2026-09-25",
      "",
      "### Fixed",
      "- **Nebulae** keep their `radius`",
      "  on save.",
      "- See [the guide](https://example.com/guide).",
      "",
      "Thanks for the reports.",
    ].join("\n");
    expect(parseReleaseNotes(notes)).toEqual([
      { kind: "heading", spans: [{ kind: "text", text: "[0.13.0] - 2026-09-25" }] },
      { kind: "heading", spans: [{ kind: "text", text: "Fixed" }] },
      {
        kind: "list",
        items: [
          [
            { kind: "strong", text: "Nebulae" },
            { kind: "text", text: " keep their " },
            { kind: "code", text: "radius" },
            { kind: "text", text: " on save." },
          ],
          [
            { kind: "text", text: "See " },
            { kind: "text", text: "the guide" },
            { kind: "text", text: "." },
          ],
        ],
      },
      { kind: "paragraph", spans: [{ kind: "text", text: "Thanks for the reports." }] },
    ]);
  });
});
