/** The rows of a pool list in rendered markup, for the tests that read what a roll can give. */

/** A segment of a row's bar, as it renders. */
export interface ShownSegment {
  grow: number;
  fill: string;
  text: string;
  label: string;
}

/** One row of a pool list: its parts as they render. */
export interface ShownPoolRow {
  /** Its `aria-label`, where it has a card; else its name. */
  title: string;
  /** Everything the row holds, its icon, name, bar column and share. */
  html: string;
  icon: string;
  name: string;
  /** What its bar column holds: a bar, its amounts as words, or nothing. */
  cell: string;
  width: string | undefined;
  segments: ShownSegment[];
  chance: string;
}

const ROW =
  /<div class="pl-pool-row"([^>]*)><span class="pl-pool-icon">(.*?)<\/span><span class="pl-pool-name">(.*?)<\/span><span class="pl-pool-cell">(.*?)<\/span><span class="muted pl-pool-chance">([^<]*)<\/span>/g;

const SEGMENT =
  /class="pl-pool-seg" style="flex-grow:([^;]*);background:([^;"]*)(?:;color:([^"]*))?">([^<]*)<\/span>/g;

/** Every pool list row in `html`, in order. */
export function poolRows(html: string): ShownPoolRow[] {
  return [...html.matchAll(ROW)].map(([whole, attributes, icon, name, cell, chance]) => ({
    title: /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? name,
    html: whole,
    icon,
    name,
    cell,
    width: /class="pl-pool-bar" style="width:([^"]*)"/.exec(cell)?.[1],
    segments: [...cell.matchAll(SEGMENT)].map(([, grow, fill, text, label]) => ({
      grow: Number(grow),
      fill,
      text: text ?? "",
      label,
    })),
    chance,
  }));
}

/** One dashed chip of a resource whose odds are unknown, as it renders. */
export interface ShownChip {
  /** Its `aria-label`. */
  title: string;
  /** Its icon, or its name where it has none. */
  icon: string;
  /** The amounts it shows. */
  amounts: string;
}

const CHIP =
  /<span id="[^"]*" class="chip pl-pool-chip" role="group" aria-label="([^"]*)" tabindex="0">(.*?)<span class="muted pl-pool-amounts">([^<]*)<\/span>/g;

/** Every dashed chip in `html`, in order. */
export function poolChips(html: string): ShownChip[] {
  return [...html.matchAll(CHIP)].map(([, title, icon, amounts]) => ({ title, icon, amounts }));
}
