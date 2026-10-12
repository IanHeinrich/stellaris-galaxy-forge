/**
 * The game's own markup in localised text: `£energy£` is a resource icon, `§Y…§!` colours what it
 * wraps, and `\n` is a line break.
 */

/** One piece of a game text, in order. */
export type GameTextSpan =
  | { kind: "text"; text: string }
  | { kind: "icon"; key: string }
  | { kind: "colour"; colour: string; children: GameTextSpan[] }
  | { kind: "break" };

/** The colour letters the app styles; any other letter still groups its text, uncoloured. */
export const GAME_TEXT_COLOURS = [
  "Y",
  "G",
  "R",
  "H",
  "B",
  "C",
  "L",
  "E",
  "P",
  "M",
  "S",
  "V",
  "W",
  "T",
  "g",
] as const;

const ICON = /^£([^£\s|]+)(?:\|[^£\s]*)?£/;
const COLOUR_OPEN = /^§([A-Za-z])/;

/** The spans of `text`. A colour left open closes at the end; a stray `§!` is dropped. */
export function parseGameText(text: string): GameTextSpan[] {
  const root: GameTextSpan[] = [];
  const open: { colour: string; children: GameTextSpan[] }[] = [];
  const into = () => open[open.length - 1]?.children ?? root;
  let run = "";
  const flush = () => {
    if (run !== "") into().push({ kind: "text", text: run });
    run = "";
  };
  const close = () => {
    flush();
    const done = open.pop();
    if (done !== undefined && done.children.length > 0) {
      into().push({ kind: "colour", colour: done.colour, children: done.children });
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = ch === "£" || ch === "§" ? text.slice(i) : "";
    const icon = ch === "£" ? ICON.exec(rest) : null;
    const colour = ch === "§" ? COLOUR_OPEN.exec(rest) : null;
    if (icon !== null) {
      flush();
      into().push({ kind: "icon", key: icon[1] });
      i += icon[0].length;
    } else if (colour !== null) {
      flush();
      open.push({ colour: colour[1].toUpperCase(), children: [] });
      i += colour[0].length;
    } else if (ch === "§" && text[i + 1] === "!") {
      if (open.length > 0) close();
      i += 2;
    } else if (ch === "\\" && text[i + 1] === "n") {
      flush();
      into().push({ kind: "break" });
      i += 2;
    } else if (ch === "\n") {
      flush();
      into().push({ kind: "break" });
      i += 1;
    } else {
      run += ch;
      i += 1;
    }
  }
  while (open.length > 0) close();
  flush();
  return root;
}

function plainOf(spans: readonly GameTextSpan[]): string {
  return spans
    .map((span) => {
      switch (span.kind) {
        case "text":
          return span.text;
        case "icon":
          return "";
        case "break":
          return " ";
        case "colour":
          return plainOf(span.children);
      }
    })
    .join("");
}

/** `text` without its icons and colours, breaks as spaces and runs of whitespace as one. */
export function plainGameText(text: string): string {
  return plainOf(parseGameText(text)).replace(/\s+/g, " ").trim();
}
