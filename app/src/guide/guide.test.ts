import { describe, expect, it } from "vitest";
import { GUIDE_PLACES, guideSlug, issueAnchor } from "../lib/guideLinks";
import { ISSUE_CODES, issueTitle } from "../lib/issueCopy";
import { shortcutLabelsByAction } from "../lib/keys";
import { LAYER_GROUPS, LAYER_LABELS } from "../lib/visual/layerIds";

const PAGES = import.meta.glob<string>(["../../../guide/**/*.md", "!**/node_modules/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const PREFIX = "../../../guide/";

/** The guide page at `path`, as `guide/<path>.md` holds it, or undefined when there is none. */
function page(path: string): string | undefined {
  return PAGES[`${PREFIX}${path}.md`];
}

function file(path: string): string {
  return `guide/${path}.md`;
}

/** What a heading's line reads as once its markup is gone, as markdown-it-anchor reads it. */
function headingText(line: string): string {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

/** The anchors VitePress gives the headings of `markdown`, with its suffix for a repeat. */
function anchors(markdown: string): Set<string> {
  const seen = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    const custom = /\{#([^}]+)\}\s*$/.exec(heading[1]);
    const base = custom ? custom[1] : guideSlug(headingText(heading[1]));
    let slug = base;
    for (let n = 1; seen.has(slug); n++) slug = `${base}-${n}`;
    seen.add(slug);
  }
  return seen;
}

/** The text of every heading, list item and table cell in `markdown`, once its markup is gone. */
function entries(markdown: string): Set<string> {
  const found = new Set<string>();
  for (const line of markdown.split("\n")) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    const cells = /^\s*\|(.*)\|\s*$/.exec(line);
    if (heading) found.add(headingText(heading[1]));
    if (item) found.add(headingText(item[1]));
    if (cells) for (const cell of cells[1].split("|")) found.add(headingText(cell));
  }
  return found;
}

/** What a `GUIDE_PLACES` entry, or a page and anchor, leaves unresolved, as a sentence each. */
function unresolved(path: string, anchor: string | undefined, from: string): string[] {
  const markdown = page(path);
  if (markdown === undefined) return [`${from}: ${file(path)} does not exist`];
  if (anchor === undefined || anchors(markdown).has(anchor)) return [];
  return [`${from}: no heading in ${file(path)} has the anchor #${anchor}`];
}

/** Every key combination the page spells in `<kbd>` tags, such as "Ctrl+Shift+Z". */
function kbdCombos(markdown: string): Set<string> {
  const combos = markdown.matchAll(/<kbd>[^<]*<\/kbd>(?:\+<kbd>[^<]*<\/kbd>)*/g);
  return new Set(
    [...combos].map((m) =>
      m[0]
        .replace(/<\/?kbd>/g, "")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))),
    ),
  );
}

describe("the app's links into the guide", () => {
  it("open a page that exists, at a heading it has", () => {
    const missing = Object.entries(GUIDE_PLACES).flatMap(([place, target]) => {
      const [path, anchor] = target.split("#");
      return unresolved(path, anchor, `GUIDE_PLACES.${place} in app/src/lib/guideLinks.ts`);
    });
    expect(missing, "Add the page or heading to the guide, or fix the link").toEqual([]);
  });

  it("open each issue kind at its own heading on the Issues page", () => {
    const [path] = GUIDE_PLACES.issues.split("#");
    const missing = ISSUE_CODES.flatMap((code) =>
      unresolved(path, issueAnchor(code), `the "${issueTitle(code)}" issue (${code})`),
    );
    expect(missing, `Add a "## <title>" heading to ${file(path)} for each`).toEqual([]);
  });
});

describe("the guide keeps up with the app", () => {
  it("lists every keyboard shortcut on the keys page", () => {
    const path = "reference/keys";
    const combos = kbdCombos(page(path) ?? "");
    const missing = [...shortcutLabelsByAction()].flatMap(([action, labels]) =>
      labels.filter((label) => !combos.has(label)).map((label) => `${label} (${action})`),
    );
    expect(missing, `Add these keys to ${file(path)}, written as <kbd> tags`).toEqual([]);
  });

  it("names every layer the Layers menu lists on the layers page", () => {
    const path = "map/layers";
    const named = entries(page(path) ?? "");
    const missing = LAYER_GROUPS.flatMap((group) => group.layers)
      .map((id) => LAYER_LABELS[id])
      .filter((label) => !named.has(label));
    expect(missing, `Add these layers to ${file(path)}`).toEqual([]);
  });
});
