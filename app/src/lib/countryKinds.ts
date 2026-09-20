import type { CountryNode } from "../generated/CountryNode";
import type { CountryTypeView } from "../generated/CountryTypeView";
import type { SpecialKind } from "../generated/SpecialKind";

export type CountryTypes = ReadonlyMap<string, CountryTypeView>;

/** Vanilla types with `is_space_critter = yes`, for when the game's definitions are not loaded. */
const FAUNA_FALLBACK =
  /^(amoeba|tiyanki|crystal|cloud|drone|voidworms|guardian_)|^(cutholoids|vluur|primal_mind|shroud_spirits|ldragon_country|clutch_of_whelps|origin_dragon|enigmatic_cache|neutral_faction|portal_holder|the_reckoning|feral_prethoryn|lured_fauna_faction)$/;

/** Vanilla types with `faction = { generate_borders = no }`, likewise. */
const BORDERLESS_FALLBACK =
  /^(enclave|mindwarden_enclave|enclave_mercenary|caravaneer_fleet|primitive|faction|nice_faction|pirate|ambient|global_event|rebel|nomad|shroud|gdf|vol|gray|ratlings|adversary|debt_collectors|synth_queen_convoys|synth_queen_outposts|marauder_raiders|ruined_marauders)$/;

const MARAUDER_FALLBACK = /^(dormant|awakened|ruined)_marauders/;

/** Space fauna and the other roaming non-empires; an ownerless fleet counts as one. */
export function isFauna(country: CountryNode | undefined, types: CountryTypes): boolean {
  if (country === undefined) return true;
  return (
    types.get(country.country_type)?.is_space_critter ?? FAUNA_FALLBACK.test(country.country_type)
  );
}

/** Whether the game paints a territory for this country's systems. */
export function drawsBorders(country: CountryNode | undefined, types: CountryTypes): boolean {
  if (country === undefined) return false;
  const type = types.get(country.country_type);
  if (type) return type.generate_borders && !type.is_space_critter;
  return (
    !FAUNA_FALLBACK.test(country.country_type) && !BORDERLESS_FALLBACK.test(country.country_type)
  );
}

export function isMarauder(country: CountryNode | undefined): boolean {
  return country !== undefined && MARAUDER_FALLBACK.test(country.country_type);
}

const FALLEN_EMPIRE_FALLBACK = /^(awakened_)?fallen_empire$/;

/** The special kind a whole territory stands for, when the country is a clan or a fallen empire. */
export function territoryKind(
  country: CountryNode | undefined,
  types: CountryTypes,
): Extract<SpecialKind, "marauder" | "fallen_empire"> | null {
  if (country === undefined) return null;
  if (isMarauder(country)) return "marauder";
  const fallen =
    types.get(country.country_type)?.fallen_empire ??
    FALLEN_EMPIRE_FALLBACK.test(country.country_type);
  return fallen ? "fallen_empire" : null;
}
