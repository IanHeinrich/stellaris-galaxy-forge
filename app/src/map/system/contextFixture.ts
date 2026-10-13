/** The save and scenario systems a context test builds its scene from, without PixiJS. */
import { expect } from "vitest";
import type { BodyLayout } from "../../generated/BodyLayout";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { MegastructureView } from "../../generated/MegastructureView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarbaseLevelView } from "../../generated/StarbaseLevelView";
import type { StarbaseSummary } from "../../generated/StarbaseSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemRoll } from "../../generated/SystemRoll";
import { SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { geometryAdapterFor, SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import {
  bodyLayout,
  byId,
  megastructureTypeView,
  placedNode,
  planetClassView,
  planetSummary,
  starbaseLevelView,
  starClassView,
  systemDetails,
} from "../../test/builders";
import { systemContext, type SystemContext } from "./context";
import { EARTH, fixed, LUNA, MARS, SUN, SYSTEM } from "./fixture";
import type { SceneStructure } from "./structures";
import { NO_SOURCES, placeIn, type SceneSubject, type SystemSources } from "./sources";

export const INITIALIZER = "context_init";

export const STAR_CLASSES: ReadonlyMap<string, StarClassView> = new Map(
  [
    starClassView("sc_g", "pc_g_star"),
    starClassView("sc_a", "pc_a_star"),
    starClassView("sc_b", "pc_b_star"),
    starClassView("sc_pulsar", "pc_pulsar"),
    starClassView("sc_binary_ab", "pc_a_star", "pc_b_star"),
  ].map((view) => [view.key, view]),
);

export const sources: SystemSources = {
  ...NO_SOURCES,
  id: SYSTEM,
  starClasses: STAR_CLASSES,
  planetClasses: new Map(
    ["pc_a_star", "pc_b_star", "pc_g_star", "pc_pulsar"]
      .map((key) => planetClassView(key))
      .concat(["pc_barren", "pc_continental"].map((key) => planetClassView(key, false)))
      .map((view) => [view.key, view]),
  ),
  gameDataReady: true,
  sceneLayers: { ...NO_SOURCES.sceneLayers, details: true },
};

/** A save system: its star at the centre and each body at its point. */
export function save(planets: PlanetSummary[], over: Partial<SystemSources> = {}) {
  return systemContext({
    ...sources,
    ...placeIn(byId({ ...placedNode(SYSTEM, 0, 0), star_class: "sc_g" }), SYSTEM),
    details: systemDetails({ id: SYSTEM, planets }),
    ...over,
  });
}

/** The scenario system's node and neighbours, of the star class the core draws for it. */
export const scenarioNode = (starClass: string) =>
  placeIn(
    byId({ ...placedNode(SYSTEM, 0, 0), star_class: starClass, initializer: INITIALIZER }),
    SYSTEM,
  );

/**
 * A scenario system of `planets` drawn in `roll`, its initializer's star class `sc_g`, edited by
 * the adapter a scenario's capabilities choose.
 */
export function scenario(
  planets: PlanetSummary[] | null,
  roll: SystemRoll | null,
  over: Partial<SystemSources> = {},
) {
  const subject: SceneSubject = {
    details: planets && systemDetails({ id: SYSTEM, planets, with_game_data: true }),
    roll,
    ...scenarioNode("sc_g"),
  };
  return systemContext({
    ...sources,
    ...subject,
    rolledLayout: SCENARIO_CAPABILITIES.rolled_layout,
    geometry: geometryAdapterFor("scenario", SCENARIO_CAPABILITIES, SYSTEM),
    ...over,
  });
}

/** A scenario body of size 12 with no ring. */
export const body = (id: number, planetClass: string, layout: Partial<BodyLayout>, over = {}) =>
  planetSummary({
    id,
    class: planetClass,
    layout: bodyLayout({ size: fixed(12), ...layout }),
    ring: false,
    ...over,
  });

export const sun = planetSummary({
  id: 1,
  class: "pc_g_star",
  star_class: "sc_g",
  layout: bodyLayout({ orbit: fixed(0), at: [0, 0], size: fixed(20) }),
});

export const scenarioSun = body(1, "pc_g_star", { orbit: fixed(0) }, { star_class: "sc_g" });

/** What `withStructures` draws a system's rows and stations with; each left out stays as it was. */
export interface StructureData {
  readonly types?: readonly MegastructureView[];
  readonly levels?: readonly StarbaseLevelView[];
  /** Localised names, by key, added to the system's. */
  readonly names?: Readonly<Record<string, string>>;
  /** The system's starbase first, then its other stations. */
  readonly stations?: readonly StarbaseSummary[];
}

/** `ctx` again with `rows` as its megastructures, drawn from the types and levels given. */
export function withStructures(
  ctx: SystemContext,
  rows: readonly MegastructureSummary[],
  { types, levels, names = {}, stations }: StructureData = {},
): SystemContext {
  const [starbase = null, ...others] = stations ?? [];
  const placed = stations && { starbase, other_starbases: others };
  return systemContext({
    ...ctx,
    details: ctx.details && { ...ctx.details, megastructures: [...rows], ...placed },
    megastructureTypes: types ? new Map(types.map((t) => [t.key, t])) : ctx.megastructureTypes,
    starbaseLevels: levels ? new Map(levels.map((l) => [l.key, l])) : ctx.starbaseLevels,
    names: new Map([...ctx.names, ...Object.entries(names)]),
  });
}

/** The one structure `ctx` draws. */
export function onlyStructure(ctx: SystemContext): SceneStructure {
  expect(ctx.structures).toHaveLength(1);
  return ctx.structures[0];
}

export const NEXUS = megastructureTypeView("think_tank_3", {
  entity: "thinktank_phase_03_entity",
  entity_offset: [0, -20],
});
export const RELAY = megastructureTypeView("hyper_relay", { entity: "hyper_relay_entity" });
export const FURNACE = megastructureTypeView("orbital_arc_furnace_1", {
  entity: "arc_furnace_entity",
  scales_with_planet: true,
});
export const FURNACE_SITE = megastructureTypeView("orbital_arc_furnace_0", {
  entity: null,
  construction_entity: "arc_furnace_construction_entity",
  construction_scale: 1.02,
});
export const RING_ROW = megastructureTypeView("orbital_ring", {
  entity: null,
  scales_with_planet: true,
});
export const ART = megastructureTypeView("art_installation_1", { entity_offset: [-27, -27] });

export const STARPORT = starbaseLevelView("starbase_level_starport", {
  icon_frame: 2,
  station_entity: "starbase_starport_section_entity",
});
export const ORBITAL_RING = starbaseLevelView("starbase_level_orbital_ring_tier_1", {
  station_entity: "orbital_ring_section_entity",
  scales_with_planet: true,
});
export const MARAUDER = starbaseLevelView("starbase_level_marauder", {
  empire_shield: true,
  station_entity: "empty_section_entity",
});

export const SAVE_TYPES = [NEXUS, RELAY, FURNACE, FURNACE_SITE, RING_ROW, ART];
export const SAVE_LEVELS = [STARPORT, ORBITAL_RING, MARAUDER];

/** A model 10 units wide and 6 tall whose origin is a quarter in and halfway down. */
export const PLACEMENT = { width: 10, height: 6, anchor_x: 0.25, anchor_y: 0.5 };

/**
 * The save system of the sun, Earth, Luna and Mars, its geometry editable, with `rows` and
 * `stations` drawn from `SAVE_TYPES` and `SAVE_LEVELS`.
 */
export function structuredSave(
  rows: readonly MegastructureSummary[],
  stations: readonly StarbaseSummary[] = [],
  over: Partial<SystemSources> = {},
): SystemContext {
  const ctx = save([SUN, EARTH, LUNA, MARS], { geometry: SAVE_GEOMETRY, ...over });
  return withStructures(ctx, rows, { types: SAVE_TYPES, levels: SAVE_LEVELS, stations });
}
