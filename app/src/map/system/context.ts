import type { BeltKindView } from "../../generated/BeltKindView";
import type { BeltLook } from "../../generated/BeltLook";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import { discRadius, WORMHOLE_RADIUS } from "../../lib/details/discs";
import { geometryOf } from "../../lib/details/geometry";
import { bypassIconKey, PLANET_ICON_KEYS } from "../../lib/details/icons";
import { boundsText, isColony, wormholeLabel, wormholePlateName } from "../../lib/details/labels";
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
import { planetResourceRows, type ResourceRow } from "../../lib/details/resources";
import { isStarBody, singleStarClasses, STAR_BODY_CLASS } from "../../lib/details/starBody";
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
}

const NO_CHANCE: Chance = Object.freeze({
  orbit: false,
  angle: false,
  planetClass: false,
  ring: false,
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
  { planetClass, starClass, drawn, model, id }: DrawnClass,
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
        { planetClass: star.class, starClass, drawn: false, model: null, id: null },
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

function sceneBodies(src: SystemSources, layout: SystemLayout): SceneBody[] {
  const details = src.details;
  if (details === null || (src.rolledLayout && details.planets.length === 0)) {
    return galaxyStars(src);
  }
  const planets = new Map(details.planets.map((p) => [p.id, p]));
  const system = systemStar(src);
  const discs = discsByPoint(layout.bodies);
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
        resources: rowsOf(planet, src.resourceIcons),
        marks: bodyMarks(planet, src.countries, details, src.names),
        readout: readoutOf(placement, discs),
        ...artOf(
          {
            planetClass: planet.class,
            starClass,
            drawn,
            model: planet.entity_name ?? null,
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
    ],
    () => sceneBodies(src, layout),
  );
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
    bodyById: lastById([bodies], () => new Map(bodies.map((b) => [b.placement.id, b]))),
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
