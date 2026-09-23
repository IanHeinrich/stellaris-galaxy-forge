/** A run of a note's text and how it is set: plain, `code` or **bold**. Links keep their text. */
export interface NoteSpan {
  kind: "text" | "code" | "strong";
  text: string;
}

export type NoteBlock =
  | { kind: "heading"; spans: NoteSpan[] }
  | { kind: "list"; items: NoteSpan[][] }
  | { kind: "paragraph"; spans: NoteSpan[] };

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
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

type Draft =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

/**
 * The changelog's Markdown as blocks: headings, bullet lists and paragraphs. A line wrapped
 * inside an entry joins the entry with a space.
 */
export function parseReleaseNotes(notes: string): NoteBlock[] {
  const drafts: Draft[] = [];
  let open: Draft | null = null;
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    if (line === "") {
      open = null;
    } else if (heading) {
      drafts.push({ kind: "heading", text: heading[1] });
      open = null;
    } else if (bullet) {
      if (open?.kind !== "list") drafts.push((open = { kind: "list", items: [] }));
      open.items.push(bullet[1]);
    } else if (open?.kind === "list") {
      open.items[open.items.length - 1] += ` ${line}`;
    } else if (open?.kind === "paragraph") {
      open.text += ` ${line}`;
    } else {
      drafts.push((open = { kind: "paragraph", text: line }));
    }
  }
  return drafts.map((d) =>
    d.kind === "list"
      ? { kind: "list", items: d.items.map(spans) }
      : { kind: d.kind, spans: spans(d.text) },
  );
}

/** The first entry of the notes as one line of plain text, for a tooltip. */
export function releaseHeadline(notes: string): string {
  for (const block of parseReleaseNotes(notes)) {
    const first =
      block.kind === "list" ? block.items[0] : block.kind === "paragraph" ? block.spans : null;
    if (first) return first.map((s) => s.text).join("");
  }
  return "";
}
