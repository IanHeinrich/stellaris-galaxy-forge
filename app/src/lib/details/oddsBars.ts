/**
 * Odds as plain bars: one row per thing a draw can give, its bar's length its share scaled so the
 * likeliest fills the track, in the thing's own colour.
 */
import { toCss } from "../visual/ownerColors";
import { NEUTRAL_RAMP } from "./resourceColors";
import type { StarOdds } from "./spawnFacts";

/** One row of an odds list. */
export interface OddsRow {
  key: string;
  /** Its share of the draw; null where a weight is unknown. */
  share: number | null;
  /** Its bar's length as a share of the track, the likeliest filling it. */
  width: number;
  /** The bar's colour, as CSS. */
  color: string;
}

/** The lightness under which a colour would not show on the dark theme. */
const DARKEST = 0.18;

/** `tint` as CSS, or the neutral tone where it is too dark to see on the dock. */
export function readableTint(tint: number): string {
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  const lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lightness < DARKEST ? NEUTRAL_RAMP[1] : toCss(tint);
}

/** A share of 0 to 1 as a CSS width. */
export function cssShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** Each share's bar length as a share of the track, the likeliest filling it; 0 where unknown. */
export function barLengths(shares: readonly (number | null)[]): number[] {
  const most = Math.max(0, ...shares.map((share) => share ?? 0));
  return shares.map((share) => (share === null || most <= 0 ? 0 : share / most));
}

/** `odds`, likeliest first as given, each with its bar's length and the colour `color` gives its key. */
export function oddsRows(odds: readonly StarOdds[], color: (key: string) => string): OddsRow[] {
  const widths = barLengths(odds.map((o) => o.share));
  return odds.map((o, i) => ({
    key: o.key,
    share: o.share,
    width: widths[i],
    color: color(o.key),
  }));
}

/** A neutral bar colour, for a draw whose things have none of their own. */
export const NEUTRAL_BAR = NEUTRAL_RAMP[1];

/**
 * `G Star` for `Class G Star`: a star class's name in a list headed "Star class", its leading
 * English "Class " dropped. Any other name, and any other language, is left as it is.
 */
export function starListName(name: string): string {
  return name.replace(/^class (?=\S)/i, "");
}
