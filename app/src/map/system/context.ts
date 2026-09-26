import type { DocumentKind } from "../../generated/DocumentKind";
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
import { isStarBody, singleStarClasses, STAR_BODY_CLASS } from "../../lib/details/starBody";
import { nodeNameIn, stripped, templateKey, templateNameIn } from "../../lib/names";
import { NO_OWNERSHIP, type Ownership } from "../../lib/ownership";
import { clusterOffsets } from "../../lib/visual/starCluster";
import { effectiveStarClass } from "../../lib/visual/starGlyphs";
import { useDetailsStore } from "../../store/detailsStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import type { EntityRef } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { currentOwnership } from "../../store/ownership";
import type { Systems } from "../RenderContext";

/** One body the scene draws, placed, named and classed. */
export interface SceneBody {
  readonly placement: BodyPlacement;
  readonly planetClass: string;
  /** The class its surface is baked from: a star written as the bare `star` takes its star class's. */
  readonly surfaceClass: string;
  /** Null for a star drawn from the galaxy's record while the system's own is not in. */
  readonly planet: PlanetSummary | null;
  readonly name: string;
  /** The star class a star is drawn as, for its art and glow; null for a planet. */
  readonly starClass: string | null;
  /** Texture keys for the icon over the disc, the first that renders drawn; none for the disc alone. */
  readonly iconKeys: readonly string[];
  /** The same while the disc is large on screen: the class's large icon, then its small one. */
  readonly largeIconKeys: readonly string[];
  /** The haze the class draws outside the limb; null for a class with none, and for a star. */
  readonly atmosphere: Atmosphere | null;
  /** Whether the body has a ring; null when a scenario leaves it to the class's chance. */
  readonly ring: boolean | null;
  readonly moon: boolean;
  /** The owner's map colour on a colonised body, which its plate shows; null for any other. */
  readonly colony: number | null;
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
  /** The star class each initializer gives its system, for a scenario system with none of its own. */
  readonly initializerClasses: ReadonlyMap<string, string>;
  readonly kind: DocumentKind | null;
  readonly gameDataReady: boolean;
  readonly resourceIcons: ReadonlyMap<string, string>;
  /** The scene's Details switch is on: each body's resources show under its name. */
  readonly detailsShown: boolean;
  /** The scene's Names switch is on: each body's name shows on a plate. */
  readonly labelsShown: boolean;
  /** The scene's Nebulae switch is on: a system in a nebula shows clouds behind it. */
  readonly nebulaShown: boolean;
  /** Who owns what, for the colour a colonised body's plate shows. */
  readonly ownership: Ownership;
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
  initializerClasses: new Map<string, string>(),
  kind: null,
  gameDataReady: false,
  resourceIcons: new Map<string, string>(),
  detailsShown: false,
  labelsShown: true,
  nebulaShown: false,
  ownership: NO_OWNERSHIP,
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
  initializerClasses: true,
  kind: true,
  gameDataReady: true,
  resourceIcons: true,
  detailsShown: true,
  labelsShown: true,
  nebulaShown: true,
  ownership: true,
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

type BodyArt = Pick<
  SceneBody,
  "surfaceClass" | "starClass" | "iconKeys" | "largeIconKeys" | "atmosphere"
>;

/**
 * A star's art: the single-star class of its body's class, else the system's own class, else the
 * one a scenario system's initializer gives it.
 */
function starArt(planetClass: string, node: SystemNode | null, src: SystemSources): BodyArt {
  const own = singlesOf(src.starClasses).get(planetClass);
  const initializer = node ? src.initializerClasses.get(node.initializer) : undefined;
  const starClass = own?.key ?? (node ? effectiveStarClass(node, initializer, src.kind) : "");
  const view = src.starClasses.get(starClass);
  const iconKeys = view?.texture_key ? [view.texture_key] : [];
  const surfaceClass =
    planetClass === STAR_BODY_CLASS ? (view?.planet_keys[0] ?? planetClass) : planetClass;
  return { surfaceClass, starClass, iconKeys, largeIconKeys: iconKeys, atmosphere: null };
}

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

function planetArt(
  planetClass: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): BodyArt {
  const view = planetClasses.get(planetClass);
  const small = view?.icon_sprite ? [`sprite:${view.icon_sprite}`] : [];
  const large = view?.icon_large_sprite ? [`sprite:${view.icon_large_sprite}`, ...small] : small;
  return {
    surfaceClass: planetClass,
    starClass: null,
    iconKeys: small,
    largeIconKeys: large,
    atmosphere: atmosphereOf(view),
  };
}

/** How far apart the stars of a system still loading stand, in discs of the largest. */
const CLUSTER_SPREAD = 4;

/** The stars the galaxy lists for a system, drawn about the centre until its own record lands. */
function galaxyStars(src: SystemSources, node: SystemNode | null): SceneBody[] {
  const isStar = (c: string) => isStarBody(c, src.planetClasses, src.starClasses);
  const listed = (node?.bodies ?? []).filter((b) => isStar(b.class));
  const stars = listed.length > 0 ? listed : [{ class: "", size: null }];
  const discs = stars.map((s) => discRadius(s.size, false, s.class, true));
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
      colony: null,
      ring: false,
      ...starArt(star.class, node, src),
    };
  });
}

function colonyColor(planet: PlanetSummary, ownership: Ownership): number | null {
  if (!planet.colonised || planet.owner === null) return null;
  return ownership.table.get(planet.owner)?.colors.outline ?? null;
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
      ? starArt(planet.class, node, src)
      : planetArt(planet.class, src.planetClasses);
    return [
      {
        placement,
        planetClass: planet.class,
        planet,
        name: src.templateName(planet),
        moon: parent !== undefined && !parent.star,
        colony: colonyColor(planet, src.ownership),
        ring: placement.star ? false : planet.ring,
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
  const chrome = useMapChromeStore.getState();
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
    initializerClasses: data.initializerClasses,
    kind: useFileSessionStore.getState().kind,
    gameDataReady: ready,
    resourceIcons: details.resourceIcons,
    detailsShown: chrome.sceneLayers.details,
    labelsShown: chrome.sceneLayers.labels,
    nebulaShown: chrome.sceneLayers.nebulae,
    ownership: currentOwnership(),
    nodeName: (name: NameTemplate) => nodeNameIn(names, name),
    templateName: (named: { name: NameTemplate; name_key: string }) =>
      templateNameIn(names, ready, resolve, named),
  });
}
