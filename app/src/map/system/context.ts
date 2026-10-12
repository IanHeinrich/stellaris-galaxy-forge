import type { BeltKindView } from "../../generated/BeltKindView";
import type { BeltLook } from "../../generated/BeltLook";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { MegastructureView } from "../../generated/MegastructureView";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarbaseSummary } from "../../generated/StarbaseSummary";
import type { StructureSpawn } from "../../generated/StructureSpawn";
import type { SystemRoll } from "../../generated/SystemRoll";
import { discRadius, WORMHOLE_RADIUS } from "../../lib/details/discs";
import { geometryOf } from "../../lib/details/geometry";
import { bypassIconKey, MEGASTRUCTURE_ICON_KEY, PLANET_ICON_KEYS } from "../../lib/details/icons";
import {
  boundsText,
  isColony,
  megastructureLabel,
  randomlyPlacedLabel,
  shownBodyName,
  starbaseKeys,
  starbaseLabel,
  wormholeLabel,
  wormholePlateName,
} from "../../lib/details/labels";
import { bodyMarks, NO_MARKS, type BodyMarks } from "../../lib/details/layout";
import {
  inspectedBody,
  isNaturalWormhole,
  type LayoutOverride,
  type SceneEditing,
} from "../../lib/details/orbitIntent";
import {
  exitBearing,
  FIT_MARGIN,
  placeholderPlanets,
  systemLayout,
  type BeltBand,
  type BodyPlacement,
  type RolledPlanet,
  type SystemLayout,
} from "../../lib/details/orbits";
import { planetResourceRows, producedRows, type ResourceRow } from "../../lib/details/resources";
import { maySpawn, neverSpawns } from "../../lib/details/spawnFacts";
import { isStarBody, singleStarClasses, STAR_BODY_CLASS } from "../../lib/details/starBody";
import {
  bodyModelKey,
  megastructureLook,
  megastructureYaw,
  modelKey,
  planetScale,
  starbaseLook,
  type StructureLook,
} from "../../lib/details/structures";
import type { Ownership } from "../../lib/ownership";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../lib/geometry/geometry";
import { clusterOffsets } from "../../lib/visual/starCluster";
import { drawnStarClass } from "../../lib/visual/starGlyphs";
import type { EntityRef } from "../../store/inspectorStore";
import type { DragMarks, HandleRef } from "./bodyDrag";
import { bodyLook, type BodyLook } from "./look";
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
  /**
   * A colony's plate and owner's flag, and its megastructure, dig site, anomaly and pre-FTL
   * icons, as the Details layer shows a system's.
   */
  readonly marks: BodyMarks;
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
  /**
   * The game may not place it: a copy past the low end of its block's count, a body round one, or
   * a body at some of whose orbits no class it can roll fits.
   */
  readonly mayNotSpawn: boolean;
  /** The game never places it: no class it can roll fits any orbit it can land at. */
  readonly never: boolean;
}

const NO_CHANCE: Chance = Object.freeze({
  orbit: false,
  angle: false,
  planetClass: false,
  ring: false,
  mayNotSpawn: false,
  never: false,
});

/**
 * An asteroid belt as the scene draws it: its band widened by its kind's width, and how its
 * pieces look.
 */
export interface SceneBelt extends BeltBand {
  readonly look: BeltLook;
  /** Its pieces glow. */
  readonly emissive: boolean;
  /** How many pieces it has against a plain belt of the same radius, its wider band included. */
  readonly density: number;
}

/** The widest a kind's band is drawn, against a plain belt's, so a wide kind leaves its planets clear. */
const MAX_BELT_WIDTH = 3;

/** How a belt of a kind the game data has not given looks. */
const PLAIN_BELT: Pick<BeltKindView, "look" | "emissive" | "width" | "density"> = Object.freeze({
  look: "rocky",
  emissive: false,
  width: 1,
  density: 1,
});

function sceneBelt(belt: BeltBand, kinds: SystemSources["beltKinds"]): SceneBelt {
  const { look, emissive, width, density } = kinds.get(belt.kind) ?? PLAIN_BELT;
  const widening = Math.min(Math.max(width, 0), MAX_BELT_WIDTH);
  const half = ((belt.outer - belt.inner) / 2) * widening;
  return {
    ...belt,
    inner: belt.radius - half,
    outer: belt.radius + half,
    look,
    emissive,
    density: Math.max(density, 0) * widening,
  };
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
 * One of the handles spaced evenly round a belt's circle or the inner radius's, from the top on
 * screen, any of which a drag moves. They show while the pointer is over the band they move.
 */
export interface SceneHandle {
  readonly ref: HandleRef;
  readonly radius: number;
  /** The belt's kind; null for the inner radius. */
  readonly beltKind: string | null;
  /** Where it is drawn, in world units. */
  readonly x: number;
  readonly y: number;
}

/** A save's wormhole or shroud tunnel, drawn at its point about the centre. */
export interface SceneWormhole {
  readonly id: number;
  /** Where it is drawn, a drag's preview included, in save units. */
  readonly x: number;
  readonly y: number;
  /** Where the save puts it. */
  readonly saved: { readonly x: number; readonly y: number };
  /** It is a natural wormhole; anything else, a shroud tunnel say, stays where it is. */
  readonly natural: boolean;
  /** A drag moves it: a natural wormhole, where the source may be edited. */
  readonly movable: boolean;
  /** "Wormhole to Sol", as its tooltip names it. */
  readonly name: string;
  /** "Hraztan Wormhole", its name plate's text. */
  readonly plateName: string;
  /** The texture key of the game's map glyph for its kind, shown at the end of its plate. */
  readonly iconKey: string | null;
}

/** What a structure the scene draws is: a megastructure row or a starbase, by its own id. */
export type StructureKind = "megastructure" | "starbase";

/** What a scenario leaves to chance about a megastructure or a starbase; a save leaves nothing. */
export interface StructureChance {
  /** The game may not place it: it is written under a condition, or in a body the game may not place. */
  readonly mayNotSpawn: boolean;
  /**
   * The game places it at random when a new game starts: it stands in at a typical spot, faint,
   * and is not picked.
   */
  readonly random: boolean;
}

const NO_STRUCTURE_CHANCE: StructureChance = Object.freeze({ mayNotSpawn: false, random: false });

function structureChance(spawn: StructureSpawn | undefined): StructureChance {
  if (spawn === undefined) return NO_STRUCTURE_CHANCE;
  return { mayNotSpawn: !spawn.always, random: spawn.place.kind === "random" };
}

/**
 * A megastructure or starbase, drawn from the game's model at its point: on the body it is tied
 * to, where that body is drawn now, else where its source puts it.
 */
export interface SceneStructure {
  readonly kind: StructureKind;
  readonly id: number;
  /** Where the model's origin stands, its type's offset included, in save units. */
  readonly x: number;
  readonly y: number;
  /** The model's texture key; null where only the map icon is drawn. */
  readonly modelKey: string | null;
  /** How many times its placement's size the model is drawn: more than 1 on a planet it grows with. */
  readonly scale: number;
  /** The map icon drawn in place of a model the game data does not know or that cannot be baked. */
  readonly iconKeys: readonly string[];
  /** What its tooltip and its name plate call it. */
  readonly name: string;
  /** Its starbase level as the Station section names it; null for a megastructure. */
  readonly level: string | null;
  /**
   * The body it stands on, under whose plate its own goes; null where it stands alone or is drawn
   * off its body.
   */
  readonly on: number | null;
  /** What it produces each month, per resource, as the Details layer shows it under its plate. */
  readonly resources: readonly ResourceRow[];
  /** What its source leaves to chance, each drawn as a marker. */
  readonly chance: StructureChance;
}

/** What the scene draws in place of the source while a drag or an edit it sent is shown. */
export interface ScenePreview {
  readonly override: LayoutOverride;
  readonly marks: DragMarks | null;
}

/**
 * A frozen snapshot of the system the scene shows, with where everything in it is drawn. Each of
 * `layout`, `bodies`, `belts`, `exits` and `rolled` is the same object as the last snapshot's while
 * nothing it is drawn from changed.
 */
export interface SystemContext extends SystemSources {
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
  /** What of the system's geometry may be edited, as its source's adapter says. */
  readonly editing: SceneEditing;
  /** The handles on its belts and inner radius, where they may be edited. */
  readonly handles: readonly SceneHandle[];
  /** Its wormholes and shroud tunnels, while the Bypasses switch is on. */
  readonly wormholes: readonly SceneWormhole[];
  /** Its megastructures and starbases, while their switch is on. */
  readonly structures: readonly SceneStructure[];
  /**
   * The radius the camera fits on entering the system: the layout's, out to the wormholes drawn,
   * which often stand near the outer radius. Only the layout's changing refits a view in place.
   */
  readonly viewRadius: number;
  /** What a drag marks; null while nothing is dragged. */
  readonly drag: DragMarks | null;
}

const NOTHING: never[] = [];

/** The class a body is drawn as, and whether it is left to a draw. */
interface DrawnClass {
  planetClass: string;
  /** The star class a star is drawn as; null for a planet. */
  starClass: string | null;
  drawn: boolean;
  /** The model a save names for a planet, drawn in place of its class's; null for none. */
  model: string | null;
  /** The texture key of the model drawn in place of its disc; null for a body drawn as a disc. */
  bodyModel: string | null;
  /** The planet's id, which a shattered class breaks by; null for a star. */
  id: number | null;
}

type BodyArt = Pick<
  SceneBody,
  "surfaceClass" | "starClass" | "look" | "iconKeys" | "largeIconKeys" | "atmosphere"
>;

interface KeptArt {
  drawn: DrawnClass;
  planetClasses: SystemSources["planetClasses"];
  starClasses: SystemSources["starClasses"];
  art: BodyArt;
}

/** Each record's art as last worked out, so a body that only moved keeps its art objects. */
const keptArt = new WeakMap<PlanetSummary, KeptArt>();

/** `freshArt`, the same objects again while the record, its class and the classes stand. */
function artOf(drawn: DrawnClass, src: SystemSources, planet: PlanetSummary | null): BodyArt {
  const kept = planet === null ? undefined : keptArt.get(planet);
  if (
    kept &&
    kept.drawn.planetClass === drawn.planetClass &&
    kept.drawn.starClass === drawn.starClass &&
    kept.drawn.drawn === drawn.drawn &&
    kept.drawn.model === drawn.model &&
    kept.drawn.bodyModel === drawn.bodyModel &&
    kept.drawn.id === drawn.id &&
    kept.planetClasses === src.planetClasses &&
    kept.starClasses === src.starClasses
  ) {
    return kept.art;
  }
  const art = freshArt(drawn, src);
  if (planet !== null) {
    keptArt.set(planet, {
      drawn,
      planetClasses: src.planetClasses,
      starClasses: src.starClasses,
      art,
    });
  }
  return art;
}

/** Each record's resource rows as last worked out, so a body that only moved keeps its rows. */
const keptRows = new WeakMap<
  PlanetSummary,
  { icons: SystemSources["resourceIcons"]; rows: readonly ResourceRow[] }
>();

function rowsOf(planet: PlanetSummary, icons: SystemSources["resourceIcons"]) {
  const kept = keptRows.get(planet);
  if (kept?.icons === icons) return kept.rows;
  const rows = planetResourceRows(planet, icons);
  keptRows.set(planet, { icons, rows });
  return rows;
}

/** Each type's production rows as last worked out, so a structure redrawn keeps its rows. */
const keptProduced = new WeakMap<
  MegastructureView,
  { icons: SystemSources["resourceIcons"]; rows: readonly ResourceRow[] }
>();

function producedOf(
  type: MegastructureView,
  icons: SystemSources["resourceIcons"],
): readonly ResourceRow[] {
  if (type.produces.length === 0) return NOTHING;
  const kept = keptProduced.get(type);
  if (kept?.icons === icons) return kept.rows;
  const rows = producedRows(type.produces, icons);
  keptProduced.set(type, { icons, rows });
  return rows;
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

/** A star's art is its star class's; a planet's is its class's icons and haze, none for a draw. */
function freshArt(
  { planetClass, starClass, drawn, model, bodyModel, id }: DrawnClass,
  src: SystemSources,
): BodyArt {
  if (starClass !== null) {
    const look = bodyLook({ planetClass, starClass, drawn });
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
  const seed = view?.shattered === true ? id : null;
  const look = bodyLook({
    planetClass,
    starClass: null,
    drawn,
    flat: view?.flat_art === true,
    hidden: view?.hidden_model === true,
    asteroid: view?.asteroid === true,
    model,
    shatterSeed: seed,
    bodyModel,
    segment: view?.ringworld === true,
  });
  const sprite = view?.icon_sprite ? [`sprite:${view.icon_sprite}`] : [];
  const small = view?.hidden_model === true ? [...sprite, ...PLANET_ICON_KEYS] : sprite;
  const large = view?.icon_large_sprite ? [`sprite:${view.icon_large_sprite}`, ...small] : small;
  return {
    surfaceClass: planetClass,
    starClass: null,
    look,
    iconKeys: small,
    largeIconKeys: large,
    atmosphere: look.shattered ? null : atmosphereOf(view),
  };
}

/** How far apart the stars of a system still loading stand, in discs of the largest. */
const CLUSTER_SPREAD = 4;

/** The system's star class, for a star that names none of its own; none outside a galaxy. */
function systemStar(src: SystemSources): string {
  return src.node ? drawnStarClass(src.node) : "";
}

/**
 * The stars the galaxy lists for a system, drawn about the centre until its own record lands:
 * with none listed, every star of its star class.
 */
function galaxyStars(src: SystemSources): SceneBody[] {
  const isStar = (c: string) => isStarBody(c, src.planetClasses, src.starClasses);
  const listed = (src.node?.bodies ?? []).filter((b) => isStar(b.class));
  const system = systemStar(src);
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
      marks: NO_MARKS,
      readout: null,
      ...artOf(
        {
          planetClass: star.class,
          starClass,
          drawn: false,
          model: null,
          bodyModel: null,
          id: null,
        },
        src,
        null,
      ),
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
    mayNotSpawn: maySpawn(planet.spawn) || neverSpawns(planet.spawn),
    never: neverSpawns(planet.spawn),
  };
}

/** The largest disc standing at each point, keyed by `pointKey`. */
function discsByPoint(placements: readonly BodyPlacement[]): Map<string, number> {
  const discs = new Map<string, number>();
  for (const { x, y, disc } of placements) {
    const key = pointKey(x, y);
    discs.set(key, Math.max(discs.get(key) ?? 0, disc));
  }
  return discs;
}

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** A body's radius readout; its ring's centre is never its own point, since its radius is above 0. */
function readoutOf(
  placement: BodyPlacement,
  discs: ReadonlyMap<string, number>,
): RadiusReadout | null {
  const { ring, radius } = placement;
  if (!ring || !radius) return null;
  return { hub: discs.get(pointKey(ring.cx, ring.cy)) ?? 0, text: boundsText(radius) };
}

/** A body's name in the scene: the name the game gives it, at its lowest numeral. */
function bodyLabel(src: SystemSources, planet: PlanetSummary): string {
  return shownBodyName(planet, src.givenNames, src.names);
}

function sceneBodies(src: SystemSources, layout: SystemLayout): SceneBody[] {
  const details = src.details;
  if (details === null || (src.rolledLayout && details.planets.length === 0)) {
    return galaxyStars(src);
  }
  const planets = new Map(details.planets.map((p) => [p.id, p]));
  const system = systemStar(src);
  const discs = discsByPoint(layout.bodies);
  // The structures layer draws the megastructures in place of their name icons.
  const marked = src.sceneLayers.megastructures ? { ...details, megastructures: NOTHING } : details;
  return layout.bodies.flatMap((placement) => {
    const planet = planets.get(placement.id);
    if (!planet) return [];
    const drawn = !placement.star && planet.drawn === true;
    const starClass = placement.star ? (planet.star_class ?? system) : null;
    // A rolled body has no point of its own, so it turns from where the roll draws it.
    const turnedFrom = src.rolledLayout ? ([placement.x, placement.y] as const) : null;
    const bodyModel =
      placement.star || drawn
        ? null
        : bodyModelKey(
            src.planetClasses.get(planet.class),
            planet,
            planet.layout?.at ?? turnedFrom,
          );
    return [
      {
        placement,
        planet,
        name: bodyLabel(src, planet),
        moon: placement.moon,
        colony: colonyColor(planet, src.ownership),
        ring: !placement.star && (planet.ring === true || (planet.ring === null && !drawn)),
        chance: chanceOf(placement, planet, drawn),
        resources: rowsOf(planet, src.resourceIcons),
        marks: bodyMarks(planet, src.countries, marked, src.names),
        readout: readoutOf(placement, discs),
        ...artOf(
          {
            planetClass: planet.class,
            starClass,
            drawn,
            model: planet.entity_name ?? null,
            bodyModel,
            id: planet.id,
          },
          src,
          planet,
        ),
      },
    ];
  });
}

function sceneExits(src: SystemSources, radius: number): Exit[] {
  const { node } = src;
  if (!node) return NOTHING;
  return src.neighbours.map(({ node: other, length }) => {
    const { dx, dy, rotation } = exitBearing(node, other);
    return {
      neighbour: other.id,
      name: src.nodeName(other.name),
      length,
      dx,
      dy,
      rotation,
      radius,
    };
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
const lastHandles = lastOf<readonly SceneHandle[]>();
const lastWormholes = lastOf<readonly SceneWormhole[]>();
const lastStructures = lastOf<readonly SceneStructure[]>();

/** How many handles stand on a circle, evenly spaced clockwise on screen from its top. */
const HANDLES_PER_CIRCLE = 6;

/** Where each handle stands on a circle about the centre, as unit steps in world units. */
const HANDLE_SPOTS: readonly (readonly [number, number])[] = Array.from(
  { length: HANDLES_PER_CIRCLE },
  (_, i) => {
    const turn = (i / HANDLES_PER_CIRCLE) * 2 * Math.PI;
    return [SAVE_X_SIGN * Math.sin(turn), -SAVE_Y_SIGN * Math.cos(turn)];
  },
);

/** The handles on the circle of `radius` about the centre, as the camera draws them. */
function handlesAt(ref: HandleRef, radius: number, beltKind: string | null): SceneHandle[] {
  return HANDLE_SPOTS.map(([x, y]) => ({ ref, radius, beltKind, x: x * radius, y: y * radius }));
}

function sceneHandles(layout: SystemLayout, editing: SceneEditing): SceneHandle[] {
  const belts = editing.belts
    ? layout.belts.flatMap((belt, index) =>
        handlesAt({ kind: "belt", index }, belt.radius, belt.kind),
      )
    : [];
  if (!editing.innerRadius) return belts;
  return [...belts, ...handlesAt({ kind: "innerRadius" }, layout.innerRadius, null)];
}

function sceneWormholes(
  src: SystemSources,
  editing: SceneEditing,
  moved: LayoutOverride["wormholes"],
): SceneWormhole[] {
  if (!src.sceneLayers.bypasses || !src.details) return NOTHING;
  const hereName = src.node ? src.nodeName(src.node.name) : "";
  return src.details.wormholes.map((w) => {
    const partner = w.partner === null ? undefined : src.systems.get(w.partner);
    const partnerName =
      w.partner === null ? null : partner ? src.nodeName(partner.name) : `#${w.partner}`;
    const at = moved?.get(w.id) ?? w;
    return {
      id: w.id,
      x: at.x,
      y: at.y,
      saved: { x: w.x, y: w.y },
      natural: isNaturalWormhole(w),
      movable: editing.wormholes.has(w.id),
      name: wormholeLabel(w.kind, partnerName),
      plateName: wormholePlateName(hereName, w.kind),
      iconKey: bypassIconKey(w.kind, src.bypassKinds),
    };
  });
}

/** Where a structure drawn as `look` stands: about `body` where it has one, else at `at`. */
function placeStructure(
  look: Exclude<StructureLook, { kind: "none" }>,
  body: SceneBody | undefined,
  at: readonly [number, number] | null,
  offset: readonly [number, number],
  grows: boolean,
): Pick<SceneStructure, "x" | "y" | "scale"> | null {
  const point = body ? [body.placement.x, body.placement.y] : at;
  if (point == null) return null;
  const scale = look.kind === "model" ? look.scale : 1;
  return {
    x: point[0] + offset[0],
    y: point[1] + offset[1],
    scale: grows && body ? scale * planetScale(body.placement.disc) : scale,
  };
}

/**
 * Where `row` stands in `roll`: a scenario row at a body stands where the roll lands the body;
 * any other row where its source puts it.
 */
function rolledAt(
  roll: SystemRoll | null,
  row: MegastructureSummary,
): readonly [number, number] | null {
  return roll?.structures?.find((s) => s.id === row.id)?.at ?? row.at;
}

function megastructure(
  src: SystemSources,
  bodyById: ReadonlyMap<number, SceneBody>,
  row: MegastructureSummary,
): SceneStructure | null {
  const type = src.megastructureTypes.get(row.kind);
  const look = megastructureLook(type);
  if (look.kind === "none") return null;
  const body = row.planet === null ? undefined : bodyById.get(row.planet);
  const offset = type?.entity_offset ?? [0, 0];
  const at = rolledAt(src.roll, row);
  const placed = placeStructure(look, body, at, offset, type?.scales_with_planet === true);
  if (placed === null) return null;
  // Turned from where its source puts it, so a drag does not bake it again at every step.
  const yaw = megastructureYaw(type, at);
  const chance = structureChance(row.spawn);
  const name = src.names.get(row.kind) ?? megastructureLabel(row.kind);
  return {
    kind: "megastructure",
    id: row.id,
    ...placed,
    modelKey: look.kind === "model" ? modelKey(row.culture, look.entity, yaw) : null,
    iconKeys: [MEGASTRUCTURE_ICON_KEY],
    name: chance.random ? randomlyPlacedLabel(name) : name,
    level: null,
    // One drawn off its body, as a Strategic Coordination Center beside its star, has its own plate.
    on: offset[0] === 0 && offset[1] === 0 ? (body?.placement.id ?? null) : null,
    resources: type ? producedOf(type, src.resourceIcons) : NOTHING,
    chance,
  };
}

function starbase(
  src: SystemSources,
  bodyById: ReadonlyMap<number, SceneBody>,
  station: StarbaseSummary,
): SceneStructure | null {
  const level = src.starbaseLevels.get(station.level);
  const look = starbaseLook(level);
  if (look.kind === "none" || station.at === null) return null;
  const grows = level?.scales_with_planet === true;
  // An orbital ring stands on the planet it rings; any other station keeps its own point.
  const body = grows && station.planet !== null ? bodyById.get(station.planet) : undefined;
  const placed = placeStructure(look, body, station.at, [0, 0], grows);
  if (placed === null) return null;
  const owner = station.owner === null ? undefined : src.countries.get(station.owner);
  const label = starbaseLabel(station.level);
  return {
    kind: "starbase",
    id: station.id,
    ...placed,
    modelKey: look.kind === "model" ? modelKey(station.culture, look.entity) : null,
    iconKeys: starbaseKeys(station.level, src.starbaseLevels, owner),
    name: src.templateName(station) || label,
    level: label,
    on: body?.placement.id ?? null,
    resources: NOTHING,
    chance: structureChance(station.spawn),
  };
}

/** Each megastructure and starbase of the system while their switch is on. */
function sceneStructures(
  src: SystemSources,
  bodyById: ReadonlyMap<number, SceneBody>,
): SceneStructure[] {
  const { details } = src;
  if (!src.sceneLayers.megastructures || details === null) return NOTHING;
  const stations = details.starbase ? [details.starbase, ...details.other_starbases] : [];
  return [
    ...details.megastructures.map((row) => megastructure(src, bodyById, row)),
    ...stations.map((station) => starbase(src, bodyById, station)),
  ].filter((s): s is SceneStructure => s !== null);
}

/**
 * Where everything of the system `src` names is drawn, with `preview`'s override and marks in
 * place of the source's own where one is shown. What may be edited is read from the source alone.
 */
export function systemContext(
  src: SystemSources,
  preview: ScenePreview | null = null,
): SystemContext {
  const { layout: base, editing } = geometryOf({ ...src, adapter: src.geometry });
  const layout = preview
    ? systemLayout(src.details, src.roll, src.planetClasses, src.moonScale, preview.override)
    : base;
  const bodies = lastBodies(
    [
      layout,
      src.node,
      src.details,
      src.rolledLayout,
      src.planetClasses,
      src.starClasses,
      src.names,
      src.gameDataReady,
      src.ownership,
      src.countries,
      src.resourceIcons,
      src.sceneLayers.megastructures,
    ],
    () => sceneBodies(src, layout),
  );
  const bodyById = lastById([bodies], () => new Map(bodies.map((b) => [b.placement.id, b])));
  const wormholes = lastWormholes(
    [
      src.details,
      src.sceneLayers.bypasses,
      editing,
      preview?.override.wormholes,
      src.systems,
      src.names,
      src.node,
      src.bypassKinds,
    ],
    () => sceneWormholes(src, editing, preview?.override.wormholes),
  );
  return Object.freeze({
    ...src,
    layout,
    bodies,
    bodyById,
    belts: lastBelts([layout.belts, src.beltKinds], () =>
      layout.belts.map((belt) => sceneBelt(belt, src.beltKinds)),
    ),
    exits: lastExits([src.node, src.neighbours, src.names, layout.innerRadius], () =>
      sceneExits(src, layout.innerRadius),
    ),
    inNebula: src.node?.nebula != null,
    rolled: lastRolled([src.roll, src.planetClasses], () =>
      src.roll?.rolls_planets ? placeholderPlanets(src.roll, src.planetClasses) : NOTHING,
    ),
    editing,
    handles: lastHandles([layout.belts, layout.innerRadius, editing], () =>
      sceneHandles(layout, editing),
    ),
    wormholes,
    structures: lastStructures(
      [
        bodies,
        src.details,
        src.roll,
        src.sceneLayers.megastructures,
        src.megastructureTypes,
        src.starbaseLevels,
        src.names,
        src.countries,
        src.resourceIcons,
        src.gameDataReady,
      ],
      () => sceneStructures(src, bodyById),
    ),
    viewRadius: Math.max(
      layout.fitRadius,
      ...wormholes.map((w) => Math.hypot(w.x, w.y) + WORMHOLE_RADIUS + FIT_MARGIN),
    ),
    drag: preview?.marks ?? null,
  });
}

export const EMPTY_SYSTEM_CONTEXT: SystemContext = systemContext(NO_SOURCES);

/** The wormhole of `ctx` that `ref` opens, or null. */
export function selectedWormhole(ctx: SystemContext, ref: EntityRef | null): number | null {
  if (ref?.kind !== "wormhole" || ref.system !== ctx.id) return null;
  return ctx.wormholes.some((w) => w.id === ref.id) ? ref.id : null;
}

/** The body of `ctx` that `ref` opens, or null, as the nudge finds it. */
export function selectedBody(ctx: SystemContext, ref: EntityRef | null): number | null {
  return inspectedBody(ctx.layout, ctx.id, ref);
}
