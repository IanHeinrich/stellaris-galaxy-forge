import { describe, expect, it } from "vitest";
import changelog from "../../../CHANGELOG.md?raw";
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
      "### Fixed",
      "- **Nebulae** keep their `radius`",
      "  on save.",
      "- See [the guide](https://example.com/guide).",
      "",
      "Thanks for the reports.",
    ].join("\n");
    expect(parseReleaseNotes(notes)).toEqual([
      { kind: "heading", spans: [{ kind: "text", text: "Fixed" }] },
      {
        kind: "list",
        items: [
          {
            spans: [
              { kind: "strong", text: "Nebulae" },
              { kind: "text", text: " keep their " },
              { kind: "code", text: "radius" },
              { kind: "text", text: " on save." },
            ],
            items: [],
          },
          {
            spans: [
              { kind: "text", text: "See " },
              { kind: "text", text: "the guide" },
              { kind: "text", text: "." },
            ],
            items: [],
          },
        ],
      },
      { kind: "paragraph", spans: [{ kind: "text", text: "Thanks for the reports." }] },
    ]);
  });

  it("nests an indented bullet under the one before it, with its wrapped lines", () => {
    const notes = [
      "- Open the system view.",
      "  - Planets show their surface,",
      "    lit from their star.",
      "  - Stars show their `class`.",
      "- Add system lists Sol.",
    ].join("\n");
    const text = (t: string) => [{ kind: "text", text: t }];
    expect(parseReleaseNotes(notes)).toEqual([
      {
        kind: "list",
        items: [
          {
            spans: text("Open the system view."),
            items: [
              text("Planets show their surface, lit from their star."),
              [
                { kind: "text", text: "Stars show their " },
                { kind: "code", text: "class" },
                { kind: "text", text: "." },
              ],
            ],
          },
          { spans: text("Add system lists Sol."), items: [] },
        ],
      },
    ]);
  });

  it("reads a line outside the subset as paragraph text", () => {
    const notes = [
      "#### Added",
      "* A star bullet.",
      "",
      "- A bullet.",
      "wrapped at the margin.",
      "",
      "  - An indented bullet with no list.",
    ].join("\n");
    const text = (t: string) => [{ kind: "text", text: t }];
    expect(parseReleaseNotes(notes)).toEqual([
      { kind: "paragraph", spans: text("#### Added * A star bullet.") },
      { kind: "list", items: [{ spans: text("A bullet."), items: [] }] },
      { kind: "paragraph", spans: text("wrapped at the margin.") },
      { kind: "paragraph", spans: text("- An indented bullet with no list.") },
    ]);
  });

  it("reads every section of the changelog as headings and lists alone", () => {
    const sections = changelog.split(/^## .*$/m).slice(1);
    expect(sections.length).toBeGreaterThan(10);
    for (const body of sections) {
      const blocks = parseReleaseNotes(body);
      expect(blocks.filter((b) => b.kind === "paragraph")).toEqual([]);
      const bullets = body.split(/\r?\n/).filter((l) => /^ {0,2}- /.test(l)).length;
      const items = blocks.flatMap((b) => (b.kind === "list" ? b.items : []));
      expect(items.length + items.flatMap((i) => i.items).length).toBe(bullets);
    }
  });
});
