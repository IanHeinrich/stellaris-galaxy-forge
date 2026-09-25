import type { CountryNode } from "../../generated/CountryNode";
import type { MapColor } from "../../generated/MapColor";

const HUE_COUNT = 14;
const SATURATION = 65;
const LIGHTNESS = 55;

function hslToHex(h: number, s: number, l: number): number {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** A deterministic colour for the `index`-th country, spread across the hue wheel. */
export function paletteColor(index: number): number {
  const hue = ((((index % HUE_COUNT) + HUE_COUNT) % HUE_COUNT) * 360) / HUE_COUNT;
  return hslToHex(hue, SATURATION, LIGHTNESS);
}

function parseHex(css: string): number | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(css);
  return m ? parseInt(m[1], 16) : undefined;
}

export interface OwnerColors {
  outline: number;
  fill: number;
}

/** Every marauder clan's colours, as the game paints them: a black fill under a near-white border. */
export const MARAUDER_COLORS: OwnerColors = { outline: 0xd0d4d8, fill: 0x000000 };

const FILL_DARKEN = 0.35;

function mapColor(
  name: string | null | undefined,
  palette: ReadonlyMap<string, MapColor>,
): number | undefined {
  const map = name ? palette.get(name)?.map : undefined;
  return map === undefined ? undefined : parseHex(map);
}

export function ownerColors(
  country: CountryNode | undefined,
  index: number,
  palette: ReadonlyMap<string, MapColor>,
): OwnerColors {
  const border = mapColor(country?.painted_border, palette);
  const fill = mapColor(country?.painted_fill, palette);
  const fallback = paletteColor(index);
  return { outline: border ?? fallback, fill: fill ?? darken(fallback, FILL_DARKEN) };
}

/** The country's outline colour: the one swatch that stands for it in legends and labels. */
export function ownerColor(
  country: CountryNode | undefined,
  index: number,
  palette: ReadonlyMap<string, MapColor>,
): number {
  return ownerColors(country, index, palette).outline;
}

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Mixes `color` towards black by `amount` in [0, 1]. */
function darken(color: number, amount: number): number {
  const channel = (shift: number): number => {
    const c = (color >> shift) & 0xff;
    return Math.round(c * (1 - amount)) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}
