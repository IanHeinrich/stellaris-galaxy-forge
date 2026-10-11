/** Which model a megastructure or a starbase is drawn from, in which culture, and at what size. */
import type { MegastructureTypeView } from "../../generated/MegastructureTypeView";
import type { ModelPlacement } from "../../generated/ModelPlacement";
import type { StarbaseLevelView } from "../../generated/StarbaseLevelView";

/** The culture every graphical culture's fallback chain ends at. */
export const DEFAULT_CULTURE = "mammalian_01";

/** The station section a level with no model of its own draws: nothing to show. */
const EMPTY_SECTION_ENTITY = "empty_section_entity";

/**
 * The disc radius at which a model that grows with its planet is drawn at its placement's size:
 * an Arc Furnace on a moon measured against the game's.
 */
export const PLANET_SCALED_DISC = 0.4488;

/** The texture key the baker draws `entity` under, in `culture` or its fallbacks. */
export function modelKey(culture: string | null, entity: string): string {
  return `model:${culture ?? DEFAULT_CULTURE}:${entity}`;
}

/** What a megastructure row or a starbase draws: a model, a map icon, or nothing. */
export type StructureLook =
  | { readonly kind: "model"; readonly entity: string; readonly scale: number }
  | { readonly kind: "icon" }
  | { readonly kind: "none" };

const ICON: StructureLook = { kind: "icon" };
const NONE: StructureLook = { kind: "none" };

/**
 * A row of `type`: its finished model, else the model shown while it is built, at its
 * construction scale. A type with neither, such as `orbital_ring`, whose rings are starbases,
 * draws nothing; a type the game data does not define keeps the map icon.
 */
export function megastructureLook(type: MegastructureTypeView | undefined): StructureLook {
  if (type === undefined) return ICON;
  if (type.entity) return { kind: "model", entity: type.entity, scale: 1 };
  if (type.construction_entity) {
    return { kind: "model", entity: type.construction_entity, scale: type.construction_scale };
  }
  return NONE;
}

/**
 * A starbase of `level`: its station's model; the map icon for a level the game data does not
 * define; nothing for a level whose station has no model, as a marauder's or a nest's.
 */
export function starbaseLook(level: StarbaseLevelView | undefined): StructureLook {
  if (level === undefined) return ICON;
  const entity = level.station_entity;
  if (!entity || entity === EMPTY_SECTION_ENTITY) return NONE;
  return { kind: "model", entity, scale: 1 };
}

/** How much larger than its placement a model that grows with a planet of drawn radius `disc` is. */
export function planetScale(disc: number): number {
  return disc / PLANET_SCALED_DISC;
}

/** A model sprite's size in save units, `scale` times its placement's. */
export function modelSize(
  placement: ModelPlacement,
  scale: number,
): { width: number; height: number } {
  return { width: placement.width * scale, height: placement.height * scale };
}
