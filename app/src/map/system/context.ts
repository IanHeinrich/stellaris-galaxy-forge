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
  type BeltBand,
  type BodyPlacement,
  type SystemLayout,
} from "../../lib/details/orbits";
import { planetResourceRows, type ResourceRow } from "../../lib/details/resources";
import { resolveBodyClasses, type ResolvedClass } from "../../lib/details/bodyClass";
import { isStarBody, STAR_BODY_CLASS } from "../../lib/details/starBody";
import { nodeNameIn, stripped, templateKey, templateNameIn } from "../../lib/names";
import { NO_OWNERSHIP, type Ownership } from "../../lib/ownership";
import { clusterOffsets } from "../../lib/visual/starCluster";
import { useDetailsStore } from "../../store/detailsStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import type { EntityRef } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { currentOwnership } from "../../store/ownership";
import type { Systems } from "../RenderContext";
import { beltTint, bodyLook, type BodyLook } from "./look";

/**
 * One body the scene draws, resolved from its source: a save and a scenario that say the same
 * about a body give the same scene body, apart from what the scenario leaves to chance. The
 * layers draw from these fields alone.
 */
export interface SceneBody {
  readonly placement: BodyPlacement;
  /**
   * The planet class it is drawn, sized and baked as: a star a scenario writes as the bare
   * `star`, or as its system's star class, takes that class's planet in turn.
   */
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
  /** The owner's map colour on a colonised body, which its plate shows; null for any other. */
  readonly colony: number | null;
  /** What its deposits yield, per resource, as the Details layer shows them. */
  readonly resources: readonly ResourceRow[];
}

/** What a scenario leaves to chance about a body; a save leaves nothing. */
export interface Chance {
  /** Its orbit is a draw between two radii. */
  readonly orbit: boolean;
  /** Its angle is a draw between two angles. */
  readonly angle: boolean;
  /** It names no angle: it may stand anywhere on its orbit. */
  readonly anyAngle: boolean;
  /** Its class is a draw: a random class, a planet list or the empire's ideal class. */
  readonly planetClass: boolean;
  /** Whether it has a ring is left to its class's chance. */
  readonly ring: boolean;
}

const NO_CHANCE: Chance = Object.freeze({
  orbit: false,
  angle: false,
  anyAngle: false,
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
  readonly belts: readonly SceneBelt[];
  readonly exits: readonly Exit[];
  /** The system lies in a nebula. */
  readonly inNebula: boolean;
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
function artOf(resolved: ResolvedClass, src: SystemSources): BodyArt {
  const { planetClass, starClass, drawn } = resolved;
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

/** The stars the galaxy lists for a system, drawn about the centre until its own record lands. */
function galaxyStars(src: SystemSources, node: SystemNode | null): SceneBody[] {
  const isStar = (c: string) => isStarBody(c, src.planetClasses, src.starClasses);
  const listed = (node?.bodies ?? []).filter((b) => isStar(b.class));
  const stars = listed.length > 0 ? listed : [{ class: STAR_BODY_CLASS, size: null }];
  const classes = resolveBodyClasses(
    stars.map((star, i) => ({ id: i, class: star.class })),
    node,
    src,
  );
  const resolved = stars.map((_, i) => classes.get(i) as ResolvedClass);
  const discs = stars.map((s, i) => discRadius(s.size, false, resolved[i].planetClass, true));
  const spread = CLUSTER_SPREAD * Math.max(...discs);
  const places = clusterOffsets(stars.length);
  return stars.map((_, i) => {
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
      planet: null,
      name: "",
      moon: false,
      colony: null,
      ring: false,
      chance: NO_CHANCE,
      resources: NOTHING,
      ...artOf(resolved[i], src),
    };
  });
}

function colonyColor(planet: PlanetSummary, ownership: Ownership): number | null {
  if (!planet.colonised || planet.owner === null) return null;
  return ownership.table.get(planet.owner)?.colors.outline ?? null;
}

function chanceOf(placement: BodyPlacement, planet: PlanetSummary, drawn: boolean): Chance {
  return {
    orbit: placement.band !== null,
    angle: placement.arc !== null,
    anyAngle: placement.ghost,
    planetClass: drawn,
    ring: !placement.star && !drawn && planet.ring === null,
  };
}

function sceneBodies(
  src: SystemSources,
  node: SystemNode | null,
  layout: SystemLayout,
  classes: ReadonlyMap<number, ResolvedClass>,
): SceneBody[] {
  if (src.details === null) return galaxyStars(src, node);
  const planets = new Map(src.details.planets.map((p) => [p.id, p]));
  const placed = new Map(layout.bodies.map((b) => [b.id, b]));
  return layout.bodies.flatMap((placement) => {
    const planet = planets.get(placement.id);
    const resolved = classes.get(placement.id);
    if (!planet || !resolved) return [];
    const parent = placement.parent === null ? undefined : placed.get(placement.parent);
    return [
      {
        placement,
        planet,
        name: src.templateName(planet),
        moon: parent !== undefined && !parent.star,
        colony: colonyColor(planet, src.ownership),
        ring:
          !placement.star && (planet.ring === true || (planet.ring === null && !resolved.drawn)),
        chance: chanceOf(placement, planet, resolved.drawn),
        resources: planetResourceRows(planet, src.resourceIcons),
        ...artOf(resolved, src),
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
  const classes = resolveBodyClasses(src.details?.planets ?? [], node, src);
  const layout = systemLayout(src.details, {
    classOf: (planet) => classes.get(planet.id),
    scenario: src.kind === "scenario",
  });
  return Object.freeze({
    ...src,
    node,
    layout,
    bodies: sceneBodies(src, node, layout, classes),
    belts: layout.belts.map((belt) => ({ ...belt, tint: beltTint(belt.kind) })),
    exits: sceneExits(src, node, layout.innerRadius),
    inNebula: node?.nebula != null,
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
