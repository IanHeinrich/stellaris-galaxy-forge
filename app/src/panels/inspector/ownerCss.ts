import type { CountryNode } from "../../generated/CountryNode";
import { ownerColor, toCss } from "../../lib/visual/ownerColors";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";

let indexes: { countries: unknown; byId: Map<number, number> } | null = null;

/** File order, the order the owners layer's fallback palette follows. */
function countryIndex(countries: ReadonlyMap<number, CountryNode>, id: number): number {
  if (indexes?.countries !== countries) {
    indexes = { countries, byId: new Map([...countries.keys()].map((key, i) => [key, i])) };
  }
  return indexes.byId.get(id) ?? 0;
}

/** The colour the map paints a country's territory with, as CSS; the neutral border without one. */
export function useOwnerCss(owner: number | null): string | null {
  const countries = useGalaxyStore((s) => s.countries);
  const mapColors = useGameDataStore((s) => s.mapColors);
  if (owner === null) return null;
  return toCss(ownerColor(countries.get(owner), countryIndex(countries, owner), mapColors));
}
