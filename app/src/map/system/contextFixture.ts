/** The save and scenario systems a context test builds its scene from, without PixiJS. */
import type { BodyLayout } from "../../generated/BodyLayout";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemRoll } from "../../generated/SystemRoll";
import { SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { geometryAdapterFor } from "../../lib/details/saveGeometry";
import {
  bodyLayout,
  byId,
  placedNode,
  planetClassView,
  planetSummary,
  starClassView,
  systemDetails,
} from "../../test/builders";
import { systemContext } from "./context";
import { fixed, SYSTEM } from "./fixture";
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
