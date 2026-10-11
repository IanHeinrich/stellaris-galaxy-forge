/**
 * Script text as a snippet shows it: moved left by the indent its lines share, cut into the tokens
 * it is coloured by, and split into lines with the ones an edit changed marked. The tokens follow
 * the core lexer's script rules: a leading BOM is skipped, CR is whitespace, `#` starts a comment
 * outside a quoted string, and `< <= > >= != ?=` are operators.
 */

/** What a token is coloured as. Operators, braces, plain values and whitespace take the text colour. */
export type ScriptTokenKind =
  | "key"
  | "keyword"
  | "scope"
  | "variable"
  | "number"
  | "string"
  | "bool"
  | "comment"
  | "operator"
  | "brace"
  | "value"
  | "space";

export interface ScriptToken {
  kind: ScriptTokenKind;
  text: string;
  /** Whether an edit changed it, where the caller asked. */
  changed?: boolean;
}

/** One line of a snippet, and whether an edit changed a token on it. */
export interface ScriptLine {
  tokens: ScriptToken[];
  changed: boolean;
}

const BOM = "﻿";

/** Longest first, so `>=` is read before `>`. */
const OPERATORS = ["==", "!=", ">=", "<=", "?=", "=", ">", "<"];

/** The words CWTools colours as the language's own. */
const KEYWORDS = new Set([
  "limit",
  "not",
  "and",
  "or",
  "nor",
  "nand",
  "if",
  "else",
  "else_if",
  "always",
  "exists",
  "hidden_trigger",
  "custom_tooltip",
  "hidden_effect",
  "modifier",
  "trigger",
  "effect",
  "weight",
  "name",
  "random",
  "random_list",
]);

const SCOPE = /^(this|root|(prev)+|(from)+|event_target:.+)$/i;
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

/** What ends an unquoted word, as the lexer's script mode has it. */
const endsWord = (c: string) => isSpace(c) || c === '"' || "{}=<>!?#".includes(c);

const isScope = (word: string) => word.split(".").every((part) => SCOPE.test(part));

function wordKind(word: string, isKey: boolean): ScriptTokenKind {
  if (word.startsWith("@")) return "variable";
  if (isScope(word)) return "scope";
  if (NUMBER.test(word)) return "number";
  const lower = word.toLowerCase();
  if (lower === "yes" || lower === "no") return "bool";
  if (isKey) return KEYWORDS.has(lower) ? "keyword" : "key";
  return "value";
}

/** The tokens of `text`, every character kept but a leading BOM. */
export function scriptTokens(text: string): ScriptToken[] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const tokens: ScriptToken[] = [];
  let at = 0;
  while (at < src.length) {
    const c = src[at];
    let end = at + 1;
    let kind: ScriptTokenKind;
    if (isSpace(c)) {
      while (end < src.length && isSpace(src[end])) end++;
      kind = "space";
    } else if (c === "#") {
      const eol = src.indexOf("\n", at);
      end = eol === -1 ? src.length : eol;
      kind = "comment";
    } else if (c === "{" || c === "}") {
      kind = "brace";
    } else if (c === '"') {
      const close = src.indexOf('"', at + 1);
      end = close === -1 ? src.length : close + 1;
      kind = "string";
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, at));
      if (op !== undefined) {
        end = at + op.length;
        kind = "operator";
      } else {
        while (end < src.length && !endsWord(src[end])) end++;
        kind = "value";
      }
    }
    tokens.push({ kind, text: src.slice(at, end) });
    at = end;
  }
  let next: ScriptToken | undefined;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.kind === "value") {
      const isKey = next !== undefined && (next.kind === "operator" || next.text === "{");
      tokens[i] = { kind: wordKind(token.text, isKey), text: token.text };
    }
    if (token.kind !== "space") next = token;
  }
  return tokens;
}

/** The spaces and tabs a line starts with. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * How many characters each line loses: the indent the non-blank lines share, leaving the first
 * line out of it when that line has none, as a statement read from its key has.
 */
function cuts(lines: readonly string[]): number[] {
  const counted = lines.filter((line, i) => line.trim() !== "" && (i > 0 || indentOf(line) > 0));
  const cut = counted.reduce((least, line) => Math.min(least, indentOf(line)), Infinity);
  if (cut === Infinity) return lines.map(() => 0);
  return lines.map((line) => Math.min(cut, indentOf(line)));
}

/** `text`'s lines, without a leading BOM or the CR before each line feed. */
function rawLines(text: string): string[] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  return src.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/** `text` moved left by the indent its lines share. */
export function dedent(text: string): string {
  const lines = rawLines(text);
  const cut = cuts(lines);
  return lines.map((line, i) => line.slice(cut[i])).join("\n");
}

/** `text` moved left and coloured, one entry per line. */
export function scriptLines(text: string): ScriptLine[] {
  const raw = rawLines(text);
  const cut = cuts(raw);
  const lines: ScriptLine[] = raw.map(() => ({ tokens: [], changed: false }));
  let line = 0;
  for (const token of scriptTokens(raw.map((l, i) => l.slice(cut[i])).join("\n"))) {
    token.text.split("\n").forEach((piece, i) => {
      if (i > 0) line++;
      if (piece !== "") lines[line].tokens.push({ kind: token.kind, text: piece });
    });
  }
  return lines;
}

/** A token that isn't whitespace, where it starts in the text, and the whitespace before it. */
interface Placed extends ScriptToken {
  start: number;
  gap: string;
}

function placed(text: string): Placed[] {
  const out: Placed[] = [];
  let at = text.startsWith(BOM) ? 1 : 0;
  let gap = "";
  for (const token of scriptTokens(text)) {
    if (token.kind === "space") gap += token.text;
    else {
      out.push({ ...token, start: at, gap });
      gap = "";
    }
    at += token.text.length;
  }
  return out;
}

const isBrace = (t: ScriptToken, brace: "{" | "}") => t.kind === "brace" && t.text === brace;

/**
 * `text` laid out as a game file lays it out, coloured, whatever its own line breaks: one statement
 * per line, each block's statements a tab further in. A block of plain values, such as `{ 1 2 3 }`,
 * stays on one line, and so does a comment after a statement. Spaces within a line are kept as
 * written. A token is changed when one of `changed`, `[start, end)` offsets into `text`, covers any
 * of it, and a line is changed when a token on it is.
 */
export function layoutLines(
  text: string,
  changed: readonly (readonly [number, number])[] = [],
): ScriptLine[] {
  const tokens = placed(text);
  const isKey = (i: number) => {
    const next = tokens[i + 1];
    const word = tokens[i].kind !== "operator" && tokens[i].kind !== "brace";
    return word && next !== undefined && (next.kind === "operator" || isBrace(next, "{"));
  };
  const inline = new Set<number>();
  const stack: { at: number; plain: boolean }[] = [];
  tokens.forEach((t, i) => {
    const top = stack[stack.length - 1];
    if (isBrace(t, "{")) {
      if (top !== undefined) top.plain = false;
      stack.push({ at: i, plain: true });
    } else if (isBrace(t, "}")) {
      const open = stack.pop();
      if (open?.plain) inline.add(open.at);
    } else if (top !== undefined && (isKey(i) || t.kind === "comment")) {
      top.plain = false;
    }
  });

  const lines: ScriptLine[] = [];
  let line: ScriptLine | null = null;
  let depth = 0;
  const opens: boolean[] = [];
  let breakNext = false;
  const covered = (t: Placed) =>
    changed.some(([s, e]) => e > s && s < t.start + t.text.length && e > t.start);
  const startLine = (indent: number) => {
    line = { tokens: [], changed: false };
    lines.push(line);
    if (indent > 0) line.tokens.push({ kind: "space", text: "\t".repeat(indent) });
    return line;
  };
  tokens.forEach((t, i) => {
    const inInline = opens.length > 0 && opens[opens.length - 1];
    let fresh: boolean;
    if (isBrace(t, "}")) {
      const wasInline = opens.pop() ?? false;
      if (!wasInline) depth = Math.max(0, depth - 1);
      fresh = !wasInline;
    } else {
      const prev = tokens[i - 1];
      fresh =
        breakNext ||
        (!inInline &&
          (isKey(i) ||
            (isBrace(t, "{") && prev !== undefined && isBrace(prev, "}")) ||
            (t.kind === "comment" && t.gap.includes("\n"))));
    }
    let current: ScriptLine = line ?? startLine(depth);
    if (fresh && current.tokens.some((p) => p.kind !== "space")) current = startLine(depth);
    else if (current.tokens.some((p) => p.kind !== "space") && t.gap !== "") {
      current.tokens.push({ kind: "space", text: t.gap.includes("\n") ? " " : t.gap });
    }
    const mark = covered(t);
    t.text.split("\n").forEach((piece, n) => {
      if (n > 0) current = startLine(0);
      if (piece !== "") current.tokens.push({ kind: t.kind, text: piece, changed: mark });
      if (mark) current.changed = true;
    });
    breakNext = t.kind === "comment" || (isBrace(t, "{") && !inline.has(i));
    if (isBrace(t, "{")) {
      opens.push(inline.has(i));
      if (!inline.has(i)) depth++;
    }
  });
  return lines;
}

/** A line's text as written. */
export function lineText(line: ScriptLine): string {
  return line.tokens.map((t) => t.text).join("");
}
