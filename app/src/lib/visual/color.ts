import { NEUTRAL_RAMP } from "./resourceColors";

/** `a` mixed towards `b` by `share` in [0, 1], channel by channel. */
export function mixColor(a: number, b: number, share: number): number {
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** `0x4ade80` → `#4ade80`. */
export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
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
