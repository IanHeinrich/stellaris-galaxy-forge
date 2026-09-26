import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemNode } from "../../generated/SystemNode";
import { discRadius } from "../../lib/details/discs";
import { boundsText, isColony } from "../../lib/details/labels";
import {
  exitBearing,
  placeholderPlanets,
  systemLayout,
  type BeltBand,
  type BodyPlacement,
  type RolledPlanet,
  type SystemLayout,
} from "../../lib/details/orbits";
import { planetResourceRows, type ResourceRow } from "../../lib/details/resources";
import { isStarBody, singleStarClasses, STAR_BODY_CLASS } from "../../lib/details/starBody";
import type { Ownership } from "../../lib/ownership";
import { clusterOffsets } from "../../lib/visual/starCluster";
import { effectiveStarClass } from "../../lib/visual/starGlyphs";
import type { EntityRef } from "../../store/inspectorStore";
import { beltTint, bodyLook, type BodyLook } from "./look";
import { NO_SOURCES, type SystemSources } from "./sources";

/**
 * One body the scene draws, resolved from its source: a save and a scenario that say the same
 * about a body give the same scene body, apart from what the scenario leaves to chance. The
 * layers draw from these fields alone.
 */
export interface SceneBody {
  readonly placement: BodyPlacement;
  /** The planet class it is drawn, sized and baked as. */
  readonly surfaceClass: string;
  /**
   * The record it was resolved from, for the Inspector; null for a star drawn from the galaxy's
   * record while the system's own is not in.
   */
  readonly planet: PlanetSummary | null;
  readonly name: string;
  /** The star class a star is drawn as, for its art and glow; null for a planet. */
  readonly starClass: string | null;
  readonly look: BodyLook;
  /** What the source leaves to chance, each drawn as a marker. */
  readonly chance: Chance;
  /** Texture keys for the icon over the disc, the first that renders drawn; none for the disc alone. */
  readonly iconKeys: readonly string[];
  /** The same while the disc is large on screen: the class's large icon, then its small one. */
  readonly largeIconKeys: readonly string[];
  /** The haze the class draws outside the limb; null for a class with none, and for a star. */
  readonly atmosphere: Atmosphere | null;
  /** Whether it is drawn with a ring: one it has, or one a known class leaves to chance. */
  readonly ring: boolean;
  readonly moon: boolean;
  /** The owner's map colour on a colony, which its plate shows; null for any other body. */
  readonly colony: number | null;
  /** What its deposits yield, per resource, as the Details layer shows them. */
  readonly resources: readonly ResourceRow[];
  /** Its orbit's radius as the readouts show it; null for a body with no ring. */
  readonly readout: RadiusReadout | null;
}

/** A body's orbit radius, as its radius line reads it. */
export interface RadiusReadout {
  /** The disc standing where its ring is centred, which its radius line starts clear of; 0 for none. */
  readonly hub: number;
  /** The radius, or a band's two ends. */
  readonly text: string;
}

/** What a scenario leaves to chance about a body; a save leaves nothing. */
export interface Chance {
  /** Its orbit is a draw between two radii. */
  readonly orbit: boolean;
  /** Its angle turns on from the body before it by a draw between two angles. */
  readonly angle: boolean;
  /** Its class is a draw: a random class, a planet list or the empire's ideal class. */
  readonly planetClass: boolean;
  /** Whether it has a ring is left to its class's chance. */
  readonly ring: boolean;
}

const NO_CHANCE: Chance = Object.freeze({
  orbit: false,
  angle: false,
  planetClass: false,
  ring: false,
});

/** An asteroid belt as the scene draws it. */
export interface SceneBelt extends BeltBand {
  readonly tint: number;
}

/** A planet class's atmosphere, as its definition gives it. */
export interface Atmosphere {
  readonly color: number;
  readonly intensity: number;
  readonly width: number;
}

/** A hyperlane leaving the system, drawn as an arrow on the inner radius towards the neighbour. */
export interface Exit {
  readonly neighbour: number;
  readonly name: string;
  readonly length: number;
  /** Unit direction to the neighbour in the galaxy's (and the scene's) frame. */
  readonly dx: number;
  readonly dy: number;
  /** The same direction in screen radians. */
  readonly rotation: number;
  /** The inner radius the arrow stands on. */
  readonly radius: number;
}

/**
 * A frozen snapshot of the system the scene shows, with where everything in it is drawn. Each of
 * `layout`, `bodies`, `belts`, `exits` and `rolled` is the same object as the last snapshot's while
 * nothing it is drawn from changed.
 */
export interface SystemContext extends SystemSources {
  readonly node: SystemNode | null;
  readonly layout: SystemLayout;
  readonly bodies: readonly SceneBody[];
  /** Each body by its placement's id. */
  readonly bodyById: ReadonlyMap<number, SceneBody>;
  readonly belts: readonly SceneBelt[];
  readonly exits: readonly Exit[];
  /** The system lies in a nebula. */
  readonly inNebula: boolean;
  /** The planets drawn to show that the game rolls this system's; none where the source has any. */
  readonly rolled: readonly RolledPlanet[];
}

const NOTHING: never[] = [];

/** The class a body is drawn as, and whether it is left to a draw. */
interface DrawnClass {
  planetClass: string;
  /** The star class a star is drawn as; null for a planet. */
  starClass: string | null;
  drawn: boolean;
}

type BodyArt = Pick<
  SceneBody,
  "surfaceClass" | "starClass" | "look" | "iconKeys" | "largeIconKeys" | "atmosphere"
>;

function atmosphereOf(view: PlanetClassView | undefined): Atmosphere | null {
  const {
    atmosphere_color: hex,
    atmosphere_intensity: intensity,
    atmosphere_width: width,
  } = view ?? {};
  if (!hex || intensity == null || width == null) return null;
  const color = Number.parseInt(hex.slice(1), 16);
  return Number.isNaN(color) ? null : { color, intensity, width };
}

/** A star's art is its star class's; a planet's is its class's icons and haze, none for a draw. */
function artOf({ planetClass, starClass, drawn }: DrawnClass, src: SystemSources): BodyArt {
  const look = bodyLook(planetClass, starClass, drawn);
  if (starClass !== null) {
    const view = src.starClasses.get(starClass);
    const iconKeys = view?.texture_key ? [view.texture_key] : [];
    return {
      surfaceClass: planetClass,
      starClass,
      look,
      iconKeys,
      largeIconKeys: iconKeys,
      atmosphere: null,
    };
  }
  const view = drawn ? undefined : src.planetClasses.get(planetClass);
  const small = view?.icon_sprite ? [`sprite:${view.icon_sprite}`] : [];
  const large = view?.icon_large_sprite ? [`sprite:${view.icon_large_sprite}`, ...small] : small;
  return {
    surfaceClass: planetClass,
    starClass: null,
    look,
    iconKeys: small,
    largeIconKeys: large,
    atmosphere: atmosphereOf(view),
  };
}

/** How far apart the stars of a system still loading stand, in discs of the largest. */
const CLUSTER_SPREAD = 4;

/** The star class a system is drawn as when its source gives it none. */
function systemStar(src: SystemSources, node: SystemNode | null): string {
  if (!node) return "";
  return effectiveStarClass(node, src.initializerClasses.get(node.initializer), src.kind);
}

/**
 * The stars the galaxy lists for a system, drawn about the centre until its own record lands:
 * with none listed, every star of its star class.
 */
function galaxyStars(src: SystemSources, node: SystemNode | null): SceneBody[] {
  const isStar = (c: string) => isStarBody(c, src.planetClasses, src.starClasses);
  const listed = (node?.bodies ?? []).filter((b) => isStar(b.class));
  const system = systemStar(src, node);
  const keys = src.starClasses.get(system)?.planet_keys ?? [];
  const stars =
    listed.length > 0
      ? listed
      : (keys.length > 0 ? keys : [STAR_BODY_CLASS]).map((c) => ({ class: c, size: null }));
  const singles = singleStarClasses(src.starClasses);
  const discs = stars.map((s) =>
    discRadius(s.size, { star: true, view: src.planetClasses.get(s.class) }),
  );
  const spread = CLUSTER_SPREAD * Math.max(...discs);
  const places = clusterOffsets(stars.length);
  return stars.map((star, i) => {
    const place = places[i];
    const placement: BodyPlacement = {
      id: -1 - i,
      x: place.dx * spread,
      y: place.dy * spread,
      disc: discs[i],
      star: true,
      moon: false,
      parent: null,
      ring: null,
      angle: 0,
      light: null,
      band: null,
      turn: null,
      radius: null,
    };
    const starClass = singles.get(star.class)?.key ?? system;
    return {
      placement,
      planet: null,
      name: "",
      moon: false,
      colony: null,
      ring: false,
      chance: NO_CHANCE,
      resources: NOTHING,
      readout: null,
      ...artOf({ planetClass: star.class, starClass, drawn: false }, src),
    };
  });
}

function colonyColor(planet: PlanetSummary, ownership: Ownership): number | null {
  if (!isColony(planet) || planet.owner === null) return null;
  return ownership.table.get(planet.owner)?.colors.outline ?? null;
}

function chanceOf(placement: BodyPlacement, planet: PlanetSummary, drawn: boolean): Chance {
  return {
    orbit: placement.band !== null,
    angle: placement.turn !== null && placement.turn.step.min !== placement.turn.step.max,
    planetClass: drawn,
    ring: !placement.star && !drawn && planet.ring === null,
  };
}

function readoutOf(
  placement: BodyPlacement,
  placements: readonly BodyPlacement[],
): RadiusReadout | null {
  const { ring, radius } = placement;
  if (!ring || !radius) return null;
  const hub = placements.reduce(
    (disc, other) =>
      other !== placement && other.x === ring.cx && other.y === ring.cy
        ? Math.max(disc, other.disc)
        : disc,
    0,
  );
  return { hub, text: boundsText(radius) };
}

function sceneBodies(
  src: SystemSources,
  node: SystemNode | null,
  layout: SystemLayout,
): SceneBody[] {
  const noBodies = src.kind === "scenario" && src.details?.planets.length === 0;
  if (src.details === null || noBodies) return galaxyStars(src, node);
  const planets = new Map(src.details.planets.map((p) => [p.id, p]));
  const system = systemStar(src, node);
  return layout.bodies.flatMap((placement) => {
    const planet = planets.get(placement.id);
    if (!planet) return [];
    const drawn = !placement.star && planet.drawn === true;
    const starClass = placement.star ? (planet.star_class ?? system) : null;
    return [
      {
        placement,
        planet,
        name: src.templateName(planet),
        moon: placement.moon,
        colony: colonyColor(planet, src.ownership),
        ring: !placement.star && (planet.ring === true || (planet.ring === null && !drawn)),
        chance: chanceOf(placement, planet, drawn),
        resources: planetResourceRows(planet, src.resourceIcons),
        readout: readoutOf(placement, layout.bodies),
        ...artOf({ planetClass: planet.class, starClass, drawn }, src),
      },
    ];
  });
}

function sceneExits(src: SystemSources, node: SystemNode | null, radius: number): Exit[] {
  if (!node) return NOTHING;
  return node.lanes.flatMap((lane) => {
    const other = src.systems.get(lane.to);
    if (!other) return [];
    const { dx, dy, rotation } = exitBearing(node, other);
    return [
      {
        neighbour: other.id,
        name: src.nodeName(other.name),
        length: lane.length,
        dx,
        dy,
        rotation,
        radius,
      },
    ];
  });
}

/** Gives the last answer again while every input is the one it was computed from. */
function lastOf<R>(): (inputs: readonly unknown[], compute: () => R) => R {
  let last: { inputs: readonly unknown[]; result: R } | null = null;
  return (inputs, compute) => {
    if (
      last &&
      last.inputs.length === inputs.length &&
      inputs.every((v, i) => v === last?.inputs[i])
    ) {
      return last.result;
    }
    last = { inputs, result: compute() };
    return last.result;
  };
}

const lastBodies = lastOf<readonly SceneBody[]>();
const lastById = lastOf<ReadonlyMap<number, SceneBody>>();
const lastBelts = lastOf<readonly SceneBelt[]>();
const lastExits = lastOf<readonly Exit[]>();
const lastRolled = lastOf<readonly RolledPlanet[]>();

/** Where everything of the system `src` names is drawn. */
export function systemContext(src: SystemSources): SystemContext {
  const node = src.id === null ? null : (src.systems.get(src.id) ?? null);
  const layout = systemLayout(src.details, src.roll, src.planetClasses, src.moonScale);
  const bodies = lastBodies(
    [
      layout,
      node,
      src.details,
      src.kind,
      src.planetClasses,
      src.starClasses,
      src.initializerClasses,
      src.names,
      src.gameDataReady,
      src.ownership,
      src.resourceIcons,
    ],
    () => sceneBodies(src, node, layout),
  );
  return Object.freeze({
    ...src,
    node,
    layout,
    bodies,
    bodyById: lastById([bodies], () => new Map(bodies.map((b) => [b.placement.id, b]))),
    belts: lastBelts([layout.belts], () =>
      layout.belts.map((belt) => ({ ...belt, tint: beltTint(belt.kind) })),
    ),
    exits: lastExits([node, src.systems, src.names, layout.innerRadius], () =>
      sceneExits(src, node, layout.innerRadius),
    ),
    inNebula: node?.nebula != null,
    rolled: lastRolled([src.roll, src.planetClasses], () =>
      src.roll?.rolls_planets ? placeholderPlanets(src.roll, src.planetClasses) : NOTHING,
    ),
  });
}

export const EMPTY_SYSTEM_CONTEXT: SystemContext = systemContext(NO_SOURCES);

/**
 * The body of `ctx` that `ref` opens, or null: a planet listed among its bodies, or a scenario body
 * of this system.
 */
export function selectedBody(ctx: SystemContext, ref: EntityRef | null): number | null {
  const ours = ref?.kind === "planet" || (ref?.kind === "body" && ref.system === ctx.id);
  if (!ours) return null;
  return ctx.bodyById.get(ref.id)?.planet ? ref.id : null;
}
