import { versionNumber } from "./version";

/** A run of a note's text and how it is set: plain, `code` or **bold**. Links keep their text. */
export interface NoteSpan {
  kind: "text" | "code" | "strong";
  text: string;
}

/** A bullet, with the bullets indented under it. */
export interface NoteItem {
  spans: NoteSpan[];
  items: NoteSpan[][];
}

export type NoteBlock =
  | { kind: "version"; version: string }
  | { kind: "heading"; spans: NoteSpan[] }
  | { kind: "list"; items: NoteItem[] }
  | { kind: "paragraph"; spans: NoteSpan[] };

const HEADING = /^### (.*)$/;
const VERSION = /^Version (\d+(?:\.\d+)+)$/;
const BULLET = /^- (.*)$/;
const NESTED = /^ {2}- (.*)$/;
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g;

function spans(text: string): NoteSpan[] {
  const out: NoteSpan[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) out.push({ kind: "text", text: text.slice(at, match.index) });
    if (match[1] !== undefined) out.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "strong", text: match[2] });
    else out.push({ kind: "text", text: match[3] });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

interface DraftItem {
  text: string;
  items: string[];
}

type Draft =
  | { kind: "version"; version: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: DraftItem[] }
  | { kind: "paragraph"; text: string };

/** The text a wrapped line continues: the last nested bullet if there is one, else the item. */
function continueItem(item: DraftItem, line: string) {
  if (item.items.length > 0) item.items[item.items.length - 1] += ` ${line}`;
  else item.text += ` ${line}`;
}

/**
 * The changelog's Markdown as blocks, in the subset `docs/maintaining.md` states: `### `
 * headings, `- ` bullets, a bullet nested at two spaces under the one before it, and indented
 * lines that continue an entry. A line outside the subset is paragraph text. A
 * `### Version x.y.z` line, which the updater's notes put over each release, is a version block.
 */
export function parseReleaseNotes(notes: string): NoteBlock[] {
  const drafts: Draft[] = [];
  let open: Draft | null = null;
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = HEADING.exec(raw);
    const bullet = BULLET.exec(raw);
    const nested = NESTED.exec(raw);
    if (line === "") {
      open = null;
    } else if (heading) {
      const text = heading[1].trim();
      const version = VERSION.exec(text);
      drafts.push(version ? { kind: "version", version: version[1] } : { kind: "heading", text });
      open = null;
    } else if (bullet) {
      if (open?.kind !== "list") drafts.push((open = { kind: "list", items: [] }));
      open.items.push({ text: bullet[1].trim(), items: [] });
    } else if (nested && open?.kind === "list") {
      open.items[open.items.length - 1].items.push(nested[1].trim());
    } else if (open?.kind === "list" && raw !== raw.trimStart()) {
      continueItem(open.items[open.items.length - 1], line);
    } else if (open?.kind === "paragraph") {
      open.text += ` ${line}`;
    } else {
      drafts.push((open = { kind: "paragraph", text: line }));
    }
  }
  return drafts.map((d) =>
    d.kind === "version"
      ? d
      : d.kind === "list"
        ? {
            kind: "list",
            items: d.items.map((item) => ({
              spans: spans(item.text),
              items: item.items.map(spans),
            })),
          }
        : { kind: d.kind, spans: spans(d.text) },
  );
}

/** Negative when `a` is the older version, numerically part by part, so 0.10.0 is after 0.9.0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The notes to show a player running `running`: each version's section newer than it, newest
 * first, or the newest alone when none is. Notes without version lines come back whole, and
 * so does every section when the running version is unknown.
 */
export function notesSince(notes: string, running: string | null): NoteBlock[] {
  const blocks = parseReleaseNotes(notes);
  const first = blocks.findIndex((b) => b.kind === "version");
  if (first < 0) return blocks;

  const sections: { version: string; blocks: NoteBlock[] }[] = [];
  for (const block of blocks.slice(first)) {
    if (block.kind === "version") sections.push({ version: block.version, blocks: [block] });
    else sections[sections.length - 1].blocks.push(block);
  }
  sections.sort((a, b) => compareVersions(b.version, a.version));

  const current = running === null ? null : versionNumber(running);
  const newer =
    current === null ? sections : sections.filter((s) => compareVersions(s.version, current) > 0);
  const shown = newer.length > 0 ? newer : sections.slice(0, 1);
  return [...blocks.slice(0, first), ...shown.flatMap((s) => s.blocks)];
}

/** The first entry of the newest version's notes as one line of plain text, for a tooltip. */
export function releaseHeadline(notes: string): string {
  for (const block of notesSince(notes, null)) {
    const first =
      block.kind === "list"
        ? block.items[0]?.spans
        : block.kind === "paragraph"
          ? block.spans
          : null;
    if (first) return first.map((s) => s.text).join("");
  }
  return "";
}
