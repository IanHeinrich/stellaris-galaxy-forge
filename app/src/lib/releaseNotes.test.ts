import { describe, expect, it } from "vitest";
import changelog from "../../../CHANGELOG.md?raw";
import { notesSince, parseReleaseNotes, releaseHeadline } from "./releaseNotes";

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

  it("comes from the newest version's section of notes that carry several", () => {
    const notes = ["### Version 0.9.0", "### Added", "- Older.", "### Version 0.10.0", "- Newest."];
    expect(releaseHeadline(notes.join("\n"))).toBe("Newest.");
  });
});

/** The updater's notes: each release's section under its `### Version` line, newest first. */
const MULTI = [
  "### Version 0.26.0",
  "",
  "### Added",
  "",
  "- The Shape tool.",
  "",
  "### Version 0.25.1",
  "",
  "### Fixed",
  "",
  "- Gateways go where you click.",
  "",
  "### Version 0.25.0",
  "",
  "### Added",
  "",
  "- Megastructures.",
].join("\n");

const versions = (blocks: ReturnType<typeof parseReleaseNotes>) =>
  blocks.flatMap((b) => (b.kind === "version" ? [b.version] : []));

describe("the notes shown to a player who skipped releases", () => {
  it("reads a Version line as a version block, not a heading", () => {
    expect(parseReleaseNotes(MULTI).slice(0, 2)).toEqual([
      { kind: "version", version: "0.26.0" },
      { kind: "heading", spans: [{ kind: "text", text: "Added" }] },
    ]);
  });

  it("keeps each version newer than the running one, with its own entries", () => {
    const blocks = notesSince(MULTI, "0.25.0");
    expect(versions(blocks)).toEqual(["0.26.0", "0.25.1"]);
    expect(JSON.stringify(blocks)).toContain("Gateways go where you click.");
    expect(JSON.stringify(blocks)).not.toContain("Megastructures.");
  });

  it("orders versions newest first by number, whatever order the notes give", () => {
    const notes = ["### Version 0.9.0", "- Nine.", "### Version 0.10.0", "- Ten."];
    notes.push("### Version 0.8.2", "- Eight.");
    expect(versions(notesSince(notes.join("\n"), "0.8.2"))).toEqual(["0.10.0", "0.9.0"]);
  });

  it("shows every version when the running one is unknown", () => {
    expect(versions(notesSince(MULTI, null))).toEqual(["0.26.0", "0.25.1", "0.25.0"]);
    expect(versions(notesSince(MULTI, "unknown"))).toEqual(["0.26.0", "0.25.1", "0.25.0"]);
  });

  it("falls back to the newest version when none is newer than the running one", () => {
    expect(versions(notesSince(MULTI, "0.26.0"))).toEqual(["0.26.0"]);
  });

  it("leaves notes with no Version lines as they are", () => {
    const notes = ["### Added", "", "- A thing.", "", "### Fixed", "", "- Another."].join("\n");
    expect(notesSince(notes, "0.1.0")).toEqual(parseReleaseNotes(notes));
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

  it("reads every section of the changelog as headings, lists and the labels over lists", () => {
    const sections = changelog.split(/^## .*$/m).slice(1);
    expect(sections.length).toBeGreaterThan(10);
    for (const body of sections) {
      const blocks = parseReleaseNotes(body);
      const unlabelled = blocks.filter(
        (b, i) => b.kind === "paragraph" && blocks[i + 1]?.kind !== "list",
      );
      expect(unlabelled).toEqual([]);
      const bullets = body.split(/\r?\n/).filter((l) => /^ {0,2}- /.test(l)).length;
      const items = blocks.flatMap((b) => (b.kind === "list" ? b.items : []));
      expect(items.length + items.flatMap((i) => i.items).length).toBe(bullets);
    }
  });
});
