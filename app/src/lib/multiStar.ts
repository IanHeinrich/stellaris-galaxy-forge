/** Binary and trinary systems: the builder's arrangements, star slots and diagrams, and their words. */
import type { Arrangement } from "../generated/Arrangement";
import type { LayoutDiagram } from "../generated/LayoutDiagram";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { StarClassView } from "../generated/StarClassView";
import type { StarType } from "../generated/StarType";
import type { CardLine } from "./addSystem";
import { starCount } from "./details/starBody";

/** How far from the centre a star stands and still makes a close group, as the core judges a shape. */
export const DISTANT_ORBIT = 60;

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
  const shapes = shapeShares(arrangementsOf(arrangements, count));
  if (shapes !== "") lines.push({ label: "Shape", text: shapes });
  return lines;
}

/** A star of a diagram as drawn in a square box: its centre and its path's radius, in pixels. */
export interface PlacedStar {
  x: number;
  y: number;
  /** The radius of the path drawn round the box's centre for a distant companion; null for others. */
  path: number | null;
}

/**
 * Where each star of `diagram` stands in a box `size` pixels square with `margin` kept clear at
 * its edges, the system's centre in the middle. Stars of a close group stay near the middle, as
 * the scale reaches at least as far as a distant companion would stand.
 */
export function diagramPlaces(diagram: LayoutDiagram, size: number, margin: number): PlacedStar[] {
  const reach = Math.max(
    DISTANT_ORBIT,
    ...diagram.stars.map((s) => Math.max(s.orbit, Math.hypot(s.x, s.y))),
  );
  const scale = (size / 2 - margin) / reach;
  const mid = size / 2;
  return diagram.stars.map((s) => ({
    x: mid + s.x * scale,
    y: mid + s.y * scale,
    path: s.orbit > DISTANT_ORBIT ? s.orbit * scale : null,
  }));
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
