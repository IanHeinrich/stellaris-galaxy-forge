import { paletteColor } from "./ownerColors";

/**
 * One colour per precursor, by its place in the install's definitions. The vanilla nine come
 * first in this order: Vultaum, Yuht, First League, Irassian, Cybrex, Baol, Zroni, Inetian
 * Traders, adAkkaria.
 */
export const PRECURSOR_COLORS: readonly number[] = [
  0xc084fc, 0x3b82f6, 0xeab308, 0x2dd4bf, 0xef4444, 0x84cc16, 0xe879f9, 0xfb923c, 0x22d3ee,
  0xfda4af,
];

/** The thin ring round a system in no precursor's region. */
export const NO_PRECURSOR_COLOR = 0x64748b;

/** The colour of the precursor defined `index`-th; past the fixed list, the owners' palette. */
export function precursorColor(index: number): number {
  return PRECURSOR_COLORS[index] ?? paletteColor(index);
}
