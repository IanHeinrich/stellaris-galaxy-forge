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
  | { kind: "heading"; spans: NoteSpan[] }
  | { kind: "list"; items: NoteItem[] }
  | { kind: "paragraph"; spans: NoteSpan[] };

const HEADING = /^### (.*)$/;
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
  | { kind: "heading"; text: string }
  | { kind: "list"; items: DraftItem[] }
  | { kind: "paragraph"; text: string };

/** The text a wrapped line continues: the last nested bullet if there is one, else the item. */
function continueItem(item: DraftItem, line: string) {
  if (item.items.length > 0) item.items[item.items.length - 1] += ` ${line}`;
  else item.text += ` ${line}`;
}

/**
 * The changelog's Markdown as blocks, in the subset `docs/engineering-rules.md` states: `### `
 * headings, `- ` bullets, a bullet nested at two spaces under the one before it, and indented
 * lines that continue an entry. A line outside the subset is paragraph text.
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
      drafts.push({ kind: "heading", text: heading[1].trim() });
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
    d.kind === "list"
      ? {
          kind: "list",
          items: d.items.map((item) => ({ spans: spans(item.text), items: item.items.map(spans) })),
        }
      : { kind: d.kind, spans: spans(d.text) },
  );
}

/** The first entry of the notes as one line of plain text, for a tooltip. */
export function releaseHeadline(notes: string): string {
  for (const block of parseReleaseNotes(notes)) {
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
