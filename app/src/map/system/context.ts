import type { NameTemplate } from "../../generated/NameTemplate";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemNode } from "../../generated/SystemNode";
import {
  discRadius,
  exitBearing,
  systemLayout,
  type BodyPlacement,
  type SystemLayout,
} from "../../lib/details/orbits";
import { isStarBody, singleStarClasses } from "../../lib/details/starBody";
import { nodeNameIn, stripped, templateKey, templateNameIn } from "../../lib/names";
import { clusterOffsets } from "../../lib/visual/starCluster";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import type { EntityRef } from "../../store/inspectorStore";
import type { Systems } from "../RenderContext";

/** One body the scene draws, placed, named and classed. */
export interface SceneBody {
  readonly placement: BodyPlacement;
  readonly planetClass: string;
  /** Null for a star drawn from the galaxy's record while the system's own is not in. */
  readonly planet: PlanetSummary | null;
  readonly name: string;
  /** The star class a star is drawn as, for its art and glow; null for a planet. */
  readonly starClass: string | null;
  /** Texture keys for the icon over the disc, the first that renders drawn; none for the disc alone. */
  readonly iconKeys: readonly string[];
  readonly moon: boolean;
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

/** What the scene reads from the stores for the one system it shows. */
export interface SystemSources {
  readonly id: number | null;
  readonly systems: Systems;
  readonly details: SystemDetails | null;
  /** The system's record has been asked for and has not come back. */
  readonly loading: boolean;
  /** The system has no record to come: its star is all the scene draws. */
  readonly missing: boolean;
  readonly names: ReadonlyMap<string, string>;
  readonly planetClasses: ReadonlyMap<string, PlanetClassView>;
  readonly starClasses: ReadonlyMap<string, StarClassView>;
  readonly gameDataReady: boolean;
  readonly resourceIcons: ReadonlyMap<string, string>;
  readonly nodeName: (name: NameTemplate) => string;
  readonly templateName: (named: { name: NameTemplate; name_key: string }) => string;
}

/**
 * A frozen snapshot of the system the scene shows, with where everything in it is drawn. The
 * scene rebuilds its layers from a new one only when a source changed.
 */
export interface SystemContext extends SystemSources {
  readonly node: SystemNode | null;
  readonly layout: SystemLayout;
  readonly bodies: readonly SceneBody[];
  readonly exits: readonly Exit[];
}

const NOTHING: never[] = [];

export const NO_SOURCES: SystemSources = Object.freeze({
  id: null,
  systems: new Map<number, SystemNode>(),
  details: null,
  loading: false,
  missing: false,
  names: new Map<string, string>(),
  planetClasses: new Map<string, PlanetClassView>(),
  starClasses: new Map<string, StarClassView>(),
  gameDataReady: false,
  resourceIcons: new Map<string, string>(),
  nodeName: (name: NameTemplate) => (name.literal ? name.key : stripped(name.key)),
  templateName: (named: { name_key: string }) => stripped(named.name_key),
});

type DataField = {
  [K in keyof SystemSources]: SystemSources[K] extends (...args: never[]) => unknown ? never : K;
}[keyof SystemSources];

/** Listed as a record so that a source added to the snapshot fails to compile until it is here. */
const DATA_FIELDS: Record<DataField, true> = {
  id: true,
  systems: true,
  details: true,
  loading: true,
  missing: true,
  names: true,
  planetClasses: true,
  starClasses: true,
  gameDataReady: true,
  resourceIcons: true,
};

const SOURCES = Object.keys(DATA_FIELDS) as DataField[];

/** Whether two snapshots were read from the same state, so the layers can be left alone. */
export function sameSources(a: SystemSources, b: SystemSources): boolean {
  return SOURCES.every((key) => a[key] === b[key]);
}

let singlesFrom: ReadonlyMap<string, StarClassView> | null = null;
let singles: ReadonlyMap<string, StarClassView> = new Map();

function singlesOf(starClasses: ReadonlyMap<string, StarClassView>) {
  if (starClasses !== singlesFrom) {
    singlesFrom = starClasses;
    singles = singleStarClasses(starClasses);
  }
  return singles;
}

/** A star's art: the single-star class of its body's class, else the system's own class. */
function starArt(
  planetClass: string,
  node: SystemNode | null,
  starClasses: ReadonlyMap<string, StarClassView>,
): { starClass: string; iconKeys: string[] } {
  const own = singlesOf(starClasses).get(planetClass);
  const starClass = own?.key ?? node?.star_class ?? "";
  const texture = starClasses.get(starClass)?.texture_key;
  return { starClass, iconKeys: texture ? [texture] : [] };
}

function planetIcon(
  planetClass: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): string[] {
  const sprite = planetClasses.get(planetClass)?.icon_sprite;
  return sprite ? [`sprite:${sprite}`] : [];
}

/** How far apart the stars of a system still loading stand, in discs of the largest. */
const CLUSTER_SPREAD = 4;

/** The stars the galaxy lists for a system, drawn about the centre until its own record lands. */
function galaxyStars(src: SystemSources, node: SystemNode | null): SceneBody[] {
  const isStar = (c: string) => isStarBody(c, src.planetClasses, src.starClasses);
  const listed = (node?.bodies ?? []).filter((b) => isStar(b.class));
  const stars = listed.length > 0 ? listed : [{ class: "", size: null }];
  const discs = stars.map((s) => discRadius(s.size, false));
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
      parent: null,
      ring: null,
      angle: 0,
      light: null,
      band: null,
      arc: null,
      ghost: false,
    };
    return {
      placement,
      planetClass: star.class,
      planet: null,
      name: "",
      moon: false,
      ...starArt(star.class, node, src.starClasses),
    };
  });
}

function sceneBodies(
  src: SystemSources,
  node: SystemNode | null,
  layout: SystemLayout,
): SceneBody[] {
  if (src.details === null) return galaxyStars(src, node);
  const planets = new Map(src.details.planets.map((p) => [p.id, p]));
  const placed = new Map(layout.bodies.map((b) => [b.id, b]));
  return layout.bodies.flatMap((placement) => {
    const planet = planets.get(placement.id);
    if (!planet) return [];
    const parent = placement.parent === null ? undefined : placed.get(placement.parent);
    const art = placement.star
      ? starArt(planet.class, node, src.starClasses)
      : { starClass: null, iconKeys: planetIcon(planet.class, src.planetClasses) };
    return [
      {
        placement,
        planetClass: planet.class,
        planet,
        name: src.templateName(planet),
        moon: parent !== undefined && !parent.star,
        ...art,
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

/** Where everything of the system `src` names is drawn. */
export function systemContext(src: SystemSources): SystemContext {
  const node = src.id === null ? null : (src.systems.get(src.id) ?? null);
  const isStar = (c: string) => isStarBody(c, src.planetClasses, src.starClasses);
  const layout = systemLayout(src.details, isStar);
  return Object.freeze({
    ...src,
    node,
    layout,
    bodies: sceneBodies(src, node, layout),
    exits: sceneExits(src, node, layout.innerRadius),
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
  return ctx.bodies.some((b) => b.planet?.id === ref.id) ? ref.id : null;
}

/** The stores' state for system `id`, as the scene reads it. */
export function readSystemSources(id: number | null): SystemSources {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  const details = useDetailsStore.getState();
  const names = data.names;
  const ready = data.status === "ready";
  const resolve = (t: NameTemplate): string | undefined => {
    const text = names.get(templateKey(t));
    if (text === undefined) data.requestName(t);
    return text;
  };
  return Object.freeze({
    id,
    systems: galaxy.systems,
    details: id === null ? null : (details.details.get(id) ?? null),
    loading: id !== null && !details.details.has(id) && details.pending.has(id),
    missing: id !== null && details.missing.has(id),
    names,
    planetClasses: data.planetClasses,
    starClasses: data.starClasses,
    gameDataReady: ready,
    resourceIcons: details.resourceIcons,
    nodeName: (name: NameTemplate) => nodeNameIn(names, name),
    templateName: (named: { name: NameTemplate; name_key: string }) =>
      templateNameIn(names, ready, resolve, named),
  });
}
