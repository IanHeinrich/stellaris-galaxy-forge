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

/** `odds`, likeliest first as given, each with its bar's length and the colour `tint` gives its key. */
export function oddsRows(odds: readonly StarOdds[], tint: (key: string) => number): OddsRow[] {
  const most = Math.max(0, ...odds.map((o) => o.share ?? 0));
  return odds.map((o) => ({
    key: o.key,
    share: o.share,
    width: o.share === null || most <= 0 ? 0 : o.share / most,
    color: readableTint(tint(o.key)),
  }));
}
