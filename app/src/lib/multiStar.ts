/** Binary and trinary systems: the builder's arrangements, star slots and diagrams, and their words. */
import type { Arrangement } from "../generated/Arrangement";
import type { LayoutDiagram } from "../generated/LayoutDiagram";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { StarClassView } from "../generated/StarClassView";
import type { StarType } from "../generated/StarType";
import { spanText, type CardLine } from "./addSystem";
import { starCount } from "./details/starBody";

/** The star counts the builder and the random rolls offer. */
export const STAR_COUNTS = [2, 3] as const;
export type StarCount = (typeof STAR_COUNTS)[number];

/** What the menu and the cards call a system of `count` stars. */
export function starSetNoun(count: StarCount): { one: string; many: string } {
  return count === 2 ? { one: "binary", many: "pairs" } : { one: "trinary", many: "trios" };
}

/** The arrangements of `count` stars, in the order the core lists them. */
export function arrangementsOf(arrangements: readonly Arrangement[], count: number): Arrangement[] {
  return arrangements.filter((a) => a.stars === count);
}

/** The arrangement built from `layout`, or null for a layout of one star or none the builder has. */
export function arrangementOf(
  arrangements: readonly Arrangement[],
  layout: string,
): Arrangement | null {
  return arrangements.find((a) => a.layout === layout) ?? null;
}

/**
 * `count` slots from `stars`: the first ones kept, and any slot past the end filled with `pad`, or
 * with the first star while there is no pad.
 */
export function slotsFor(stars: readonly string[], count: number, pad?: string): string[] {
  const fill = pad ?? stars[0];
  const kept = stars.slice(0, count);
  if (fill === undefined) return kept;
  while (kept.length < count) kept.push(fill);
  return kept;
}

/**
 * `count` star slots from `stars`: those `starTypes` no longer offer, as a removed mod's, left
 * out, the first ones kept, and a slot past the end given the first star, or the first star type
 * when none is left.
 */
export function fitSlots(
  stars: readonly string[],
  count: number,
  starTypes: readonly StarType[] | null,
): string[] {
  const offered = starTypes === null ? null : new Set(starTypes.map((t) => t.key));
  const kept = offered === null ? [...stars] : stars.filter((star) => offered.has(star));
  return slotsFor(kept, count, kept[0] ?? starTypes?.[0]?.key);
}

/**
 * The game's own classes of `count` stars a galaxy draws: none a crisis swaps in, none only
 * scripts set, none defined only so its key is valid.
 */
export function gameStarSets(
  starClasses: Iterable<StarClassView>,
  count: number,
  crisisVariants: ReadonlySet<string>,
): StarClassView[] {
  return [...starClasses].filter(
    (view) =>
      view.spawn_odds > 0 &&
      view.placeholder !== true &&
      !crisisVariants.has(view.key) &&
      starCount(view) === count,
  );
}

/** "6 in 10" for a share of 0.6; a share under one in twenty reads "under 1 in 10". */
function shareText(share: number): string {
  const tenths = Math.round(share * 10);
  return tenths === 0 ? "under 1 in 10" : `${tenths} in 10`;
}

/** Each shape's share of the draw: "Close pair 6 in 10, distant companion 4 in 10". */
export function shapeShares(arrangements: readonly Arrangement[]): string {
  const shares = new Map<string, number>();
  for (const a of arrangements) shares.set(a.name, (shares.get(a.name) ?? 0) + a.share);
  return [...shares]
    .map(([name, share], i) => {
      const said = i === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1);
      return `${said} ${shareText(share)}`;
    })
    .join(", ");
}

/** The card of a random binary or trinary: which stars it draws from, and how they are arranged. */
export function randomStarsCard(
  count: StarCount,
  arrangements: readonly Arrangement[],
  gameSets: number,
): CardLine[] {
  const lines: CardLine[] = [];
  if (gameSets > 0) {
    lines.push({
      label: "Stars",
      text: `Any of the game's ${gameSets} ${starSetNoun(count).many}`,
    });
  }
  const offered = arrangementsOf(arrangements, count);
  const shapes = shapeShares(offered);
  if (shapes !== "") lines.push({ label: "Shape", text: shapes });
  if (offered.length > 0) {
    const min = Math.min(...offered.map((a) => a.planets.min));
    const max = Math.max(...offered.map((a) => a.planets.max));
    lines.push({ label: "Planets", text: spanText({ min, max }) });
  }
  return lines;
}

/** A star of a diagram as drawn in a square box: its centre and its path's radius, in pixels. */
export interface PlacedStar {
  x: number;
  y: number;
  /** The radius of the path drawn round the system's centre for a distant companion; null for others. */
  path: number | null;
}

/** A diagram fitted to a square box: where its stars stand, the system's centre, and the art's size. */
export interface DiagramFit {
  stars: PlacedStar[];
  /** Where the system's centre falls, which a distant companion's path goes round. */
  centre: { x: number; y: number };
  /** The side of each star's art, in pixels. */
  starSize: number;
}

/** How a diagram is fitted: the box's side, the art's largest and smallest side, and room under each star. */
export interface FitOptions {
  size: number;
  maxStar: number;
  minStar: number;
  /** Space kept clear under the lowest star, for its label. */
  below?: number;
  /**
   * How far from the centre, in game units, a whole system reaches: one scale for every
   * arrangement, so a close group looks close and a distant one fills the box. Unset, the
   * diagram's own reach.
   */
  reach?: number;
}

/** The share of the gap to its nearest neighbour a star's art may take, so neighbours never touch. */
const ART_SHARE = 0.8;
/** How far apart, in art sizes, the nearest two stars' centres are kept at the least. */
const SEPARATION = 1.3;
/** Space kept clear between the art and the box's edge. */
const EDGE_PX = 2;

/** The furthest any of `arrangements` reaches: one scale that shows a whole system for all of them. */
export function systemReach(arrangements: readonly Arrangement[] | null): number | undefined {
  if (arrangements === null || arrangements.length === 0) return undefined;
  return Math.max(...arrangements.map((a) => diagramReach(a.diagram)));
}

/** How far from its centre a diagram's stars, and a distant companion's path, reach. */
export function diagramReach(diagram: LayoutDiagram): number {
  return Math.max(0, ...diagram.stars.map((s) => Math.max(s.orbit, Math.hypot(s.x, s.y))));
}

/**
 * `diagram` scaled into a box `size` pixels square, centred on its stars and each distant
 * companion's path: at the scale that shows a whole system of `reach`, the same for every
 * arrangement, unless its nearest two stars would then crowd each other, and never so large that
 * any of it leaves the box. The art is `maxStar` across, and shrinks to `minStar` at the least
 * only where neighbours would otherwise touch.
 */
export function fitDiagram(diagram: LayoutDiagram, options: FitOptions): DiagramFit {
  const { size, maxStar, minStar, below = 0 } = options;
  const reach = options.reach ?? diagramReach(diagram);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of diagram.stars) {
    xs.push(s.x);
    ys.push(s.y);
    if (s.distant) {
      xs.push(-s.orbit, s.orbit);
      ys.push(-s.orbit, s.orbit);
    }
  }
  const box = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
  const nearest = nearestGap(diagram.stars);
  const place = (starSize: number): DiagramFit => {
    const pad = starSize / 2 + EDGE_PX;
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const across = width > 0 ? (size - 2 * pad) / width : Infinity;
    const down = height > 0 ? (size - 2 * pad - below) / height : Infinity;
    const frame = Math.min(across, down);
    const system = reach > 0 ? (size / 2 - pad - below / 2) / reach : Infinity;
    const separation =
      Number.isFinite(nearest) && nearest > 0 ? (SEPARATION * starSize) / nearest : 0;
    const chosen = Math.min(frame, Math.max(separation, system));
    const scale = Number.isFinite(chosen) ? Math.max(0, chosen) : 0;
    const left = (size - width * scale) / 2 - box.left * scale;
    const top = (size - below - height * scale) / 2 - box.top * scale;
    return {
      stars: diagram.stars.map((s) => ({
        x: left + s.x * scale,
        y: top + s.y * scale,
        path: s.distant ? s.orbit * scale : null,
      })),
      centre: { x: left, y: top },
      starSize,
    };
  };
  let fit = place(maxStar);
  for (let i = 0; i < 3; i++) {
    const wanted = Math.max(minStar, Math.min(maxStar, ART_SHARE * nearestGap(fit.stars)));
    if (wanted >= fit.starSize) break;
    fit = place(wanted);
  }
  return fit;
}

/** The shortest distance between two of `stars`, or Infinity for fewer than two. */
function nearestGap(stars: readonly { x: number; y: number }[]): number {
  let nearest = Infinity;
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      nearest = Math.min(nearest, Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y));
    }
  }
  return nearest;
}

/** How wide a label of `text` is drawn, in pixels, at the diagram's fine text. */
function labelWidth(text: string): number {
  return text.length * 6 + 4;
}

/** The line a label takes, in pixels. */
const LABEL_LINE = 12;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Where a label goes: its centre's x and its top, in pixels. */
export interface LabelPlace {
  x: number;
  top: number;
}

/**
 * Where each of `labels` goes, under its own star's art, nudged out from the system's centre
 * while it would touch another label or another star's art; null when they would still touch, so
 * none is drawn.
 */
export function placeLabels(fit: DiagramFit, labels: readonly string[]): LabelPlace[] | null {
  const half = fit.starSize / 2;
  const arts: Box[] = fit.stars.map((p) => ({
    left: p.x - half,
    right: p.x + half,
    top: p.y - half,
    bottom: p.y + half,
  }));
  const boxOf = (place: LabelPlace, i: number): Box => {
    const w = labelWidth(labels[i] ?? "") / 2;
    return {
      left: place.x - w,
      right: place.x + w,
      top: place.top,
      bottom: place.top + LABEL_LINE,
    };
  };
  const places: LabelPlace[] = fit.stars.map((p) => ({ x: p.x, top: p.y + half + 1 }));
  const clashes = (i: number) => {
    const box = boxOf(places[i], i);
    return (
      places.some((other, j) => j !== i && overlap(box, boxOf(other, j))) ||
      arts.some((art, j) => j !== i && overlap(box, art))
    );
  };
  const STEP = 4;
  for (let round = 0; round < 4; round++) {
    let moved = false;
    places.forEach((place, i) => {
      if (!clashes(i)) return;
      const p = fit.stars[i];
      const dx = p.x - fit.centre.x;
      const dy = p.y - fit.centre.y;
      const length = Math.hypot(dx, dy) || 1;
      place.x += (dx / length) * STEP;
      place.top += (dy / length) * STEP;
      moved = true;
    });
    if (!moved) return places;
  }
  return places.some((_, i) => clashes(i)) ? null : places;
}

/**
 * The art the galaxy view draws for a star of the planet class `star`: the texture of the class
 * that is that star alone, then the planet class's own sprite.
 */
export function starArtKeys(
  star: string,
  singles: ReadonlyMap<string, StarClassView>,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): string[] {
  const texture = singles.get(star)?.texture_key;
  const sprite = planetClasses.get(star)?.icon_sprite;
  return [...(texture ? [texture] : []), ...(sprite ? [`sprite:${sprite}`] : [])];
}

/**
 * The star of each body a diagram of `count` stars draws for a special layout filed under
 * `starClass`: the class's own stars when it has as many, else its first star in every place.
 */
export function specialStars(starClass: StarClassView | undefined, count: number): string[] {
  const keys = starClass?.planet_keys ?? [];
  if (keys.length === count) return [...keys];
  return keys.length > 0 ? slotsFor([keys[0]], count) : [];
}

/** The name `starTypes` give the star `key`, or the key while they are unread. */
export function starTypeName(starTypes: readonly StarType[] | null, key: string): string {
  return starTypes?.find((t) => t.key === key)?.name ?? key;
}

/**
 * Short names for the star types: each name less the words at least half the usual types' names
 * share, such as "Class" and "Star" in English, so "Class A Star" reads "A" and "Pulsar" stays. With
 * `leading` only the first word goes, and only when at least half the usual names start with it,
 * so "Class A Star" reads "A Star" and "Neutron Star" stays. A name those words make up entirely,
 * or a key `starTypes` lack, keeps its full name.
 */
export function shortStarNames(
  starTypes: readonly StarType[],
  leading = false,
): (key: string) => string {
  const usual = starTypes.filter((t) => t.usual);
  const words = (name: string) => name.split(/\s+/).filter((w) => w !== "");
  const counts = new Map<string, number>();
  for (const t of usual) {
    const all = words(t.name).map((w) => w.toLowerCase());
    for (const word of new Set(leading ? all.slice(0, 1) : all)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const common = new Set(
    [...counts].filter(([, n]) => usual.length > 1 && n * 2 >= usual.length).map(([w]) => w),
  );
  const short = new Map(
    starTypes.map((t) => {
      const all = words(t.name);
      const kept = leading
        ? all.filter((w, i) => i > 0 || !common.has(w.toLowerCase()))
        : all.filter((w) => !common.has(w.toLowerCase()));
      return [t.key, kept.length > 0 ? kept.join(" ") : t.name];
    }),
  );
  return (key) => short.get(key) ?? key;
}
