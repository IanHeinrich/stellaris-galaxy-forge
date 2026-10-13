/** Which model a megastructure or a starbase is drawn from, in which culture, and at what size. */
import type { MegastructureView } from "../../generated/MegastructureView";
import type { ModelPlacement } from "../../generated/ModelPlacement";
import type { ModelUse } from "../../generated/ModelUse";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarbaseLevelView } from "../../generated/StarbaseLevelView";

/** The culture the baker reads as owned by no empire: the game draws such a model's bare entity. */
export const NO_CULTURE = "none";

/** The station section a level with no model of its own draws: nothing to show. */
const EMPTY_SECTION_ENTITY = "empty_section_entity";

/**
 * The disc radius at which a model that grows with its planet is drawn at its placement's size:
 * an Arc Furnace on a moon measured against the game's.
 */
export const PLANET_SCALED_DISC = 0.4488;

/**
 * The texture key the baker draws `entity` under, in `culture` or its fallbacks, or bare for no
 * culture, turned `yaw` whole degrees about its up axis, and baked at most `px` pixels along its
 * longer side when given.
 */
export function modelKey(culture: string | null, entity: string, yaw = 0, px?: number): string {
  const base = `model:${culture ?? NO_CULTURE}:${entity}`;
  const turned = yaw === 0 ? base : `${base}:yaw${yaw}`;
  return px === undefined ? turned : `${turned}:px${px}`;
}

/** Closer to the centre than this, in save units, a model stands on the star and is not turned. */
const ON_CENTRE = 1e-6;

/**
 * The turn, in whole degrees from 0 to 359, that points a model standing at save point (x, y)
 * with its −Z towards the system's centre. Model Z is +save x and model X is −save y, and the
 * turn takes Z towards X; a model on the centre is not turned.
 */
export function facingYaw(x: number, y: number): number {
  if (Math.hypot(x, y) < ON_CENTRE) return 0;
  const degrees = Math.round((Math.atan2(-y, x) * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

/** The turn a row of `type` standing at `at` is drawn with: it faces the star unless its type says not. */
export function megastructureYaw(
  type: MegastructureView | undefined,
  at: readonly [number, number] | null,
): number {
  if (at === null || type?.rotate_to_center === false) return 0;
  return facingYaw(at[0], at[1]);
}

/**
 * The model a planet of `view`'s class is drawn from in place of its disc: the save's own model
 * for it, else its class's; null for a class drawn as a disc. A ring world segment turns to face
 * the star from `at`, where the save puts it, and is drawn bare as the game draws a shattered
 * ring's colony; a habitat is not turned and takes its owner's culture.
 */
export function bodyModelKey(
  view: PlanetClassView | undefined,
  planet: { entity_name?: string; culture?: string },
  at: readonly [number, number] | null,
): string | null {
  const entity = view?.body_model ? (planet.entity_name ?? view.body_model) : null;
  if (!entity) return null;
  if (view?.ringworld !== true) return modelKey(planet.culture ?? null, entity);
  return modelKey(null, entity, at === null ? 0 : facingYaw(at[0], at[1]));
}

/** The game data each of a save's model keys is chosen by. */
export interface ModelSources {
  readonly megastructureTypes: ReadonlyMap<string, MegastructureView>;
  readonly starbaseLevels: ReadonlyMap<string, StarbaseLevelView>;
  readonly planetClasses: ReadonlyMap<string, PlanetClassView>;
}

/** The key `use` is drawn from, chosen as the system view chooses it; null for none. */
function keyOfUse(use: ModelUse, src: ModelSources): string | null {
  switch (use.kind) {
    case "megastructure": {
      // A row with no point is not drawn: the save puts a row on a body at the body's point.
      if (use.at === null) return null;
      const type = src.megastructureTypes.get(use.key);
      const look = megastructureLook(type);
      if (look.kind !== "model") return null;
      return modelKey(use.culture, look.entity, megastructureYaw(type, use.at));
    }
    case "starbase": {
      const look = starbaseLook(src.starbaseLevels.get(use.key));
      return look.kind === "model" ? modelKey(use.culture, look.entity) : null;
    }
    case "planet":
      return bodyModelKey(
        src.planetClasses.get(use.key),
        { entity_name: use.entity ?? undefined, culture: use.culture ?? undefined },
        use.at,
      );
  }
}

/** Every model key `uses` draw, each once, in the order first used. */
export function modelKeysOf(uses: readonly ModelUse[], src: ModelSources): string[] {
  const keys = new Set<string>();
  for (const use of uses) {
    const key = keyOfUse(use, src);
    if (key !== null) keys.add(key);
  }
  return [...keys];
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
export function megastructureLook(type: MegastructureView | undefined): StructureLook {
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
