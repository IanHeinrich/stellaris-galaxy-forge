/** Where the details bar puts the name row, the plate behind it and the planets beside the star. */
import type { CountryNode } from "../../generated/CountryNode";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { isMarauder } from "../countryKinds";
import { DETAIL_SCALE } from "../visual/labels";
import { STAR_BASE_PX, starDiameterPx } from "../visual/starSize";
import { CAPITAL_PLATE_KEY, PLATE_KEY } from "./icons";
import { FALLBACK_HABITABLE } from "./labels";

/** Zoom (pixels per world unit) at which system details pop in, shared with the star art tier. */
export const DETAILS_MIN_SCALE = DETAIL_SCALE;

/** Gap between the star's on-screen edge and the top of its name row, in screen pixels. */
const STAR_LABEL_GAP_PX = 4;
/** The row tucks this share of the star's diameter into its glow, as the game's does. */
const STAR_LABEL_TUCK = 0.25;

/** Vertical offset of the name row below the star's centre, following the star's on-screen size. */
export function nameRowY(camScale: number): number {
  const diameter = starDiameterPx(STAR_BASE_PX, camScale);
  return diameter / 2 + STAR_LABEL_GAP_PX - diameter * STAR_LABEL_TUCK;
}

/** The name label under the star in screen pixels, as `LabelsLayer` draws it and the details bar wraps it. */
export const NAME_ROW = {
  height: 17,
  /** Between the name and the emblem or icons beside it. */
  gap: 3,
  iconPx: 26,
};

/** The habitable planets stack left of the star, on its level, each tucked under the one nearer the star. */
export const PLANET_STACK = {
  /** Gap between the star's centre and the stack's right edge. */
  gap: 12,
  stride: 7,
  max: 6,
};
const PLATE_PAD_PX = 3;
/** The plate hugs the text: a little above the caps, a little more below the descenders. */
const PLATE_ABOVE_PX = 2;
const PLATE_BELOW_PX = 5;
const PLATE_HEIGHT_PX = NAME_ROW.height + PLATE_ABOVE_PX + PLATE_BELOW_PX;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The left edge of the name row: the emblem, when there is one, sits left of a name `half` wide. */
export function rowLeft(half: number, emblem: boolean): number {
  return emblem ? -half - NAME_ROW.gap - NAME_ROW.iconPx : -half;
}

/** Where the plate goes behind the name: a few pixels past the text each side, clear of the emblem and icons. */
export function plateBox(half: number, rowY: number): Box {
  return {
    x: -half - PLATE_PAD_PX,
    y: rowY - PLATE_ABOVE_PX,
    width: 2 * (half + PLATE_PAD_PX),
    height: PLATE_HEIGHT_PX,
  };
}

/** The plate's bottom edge, below which the resource row starts. */
export function plateBottom(rowY: number): number {
  return rowY + NAME_ROW.height + PLATE_BELOW_PX;
}

/** The plate under a colonised system's name, the capital's when the owner's capital is here; none otherwise. */
export function plateKey(d: SystemDetails): string | null {
  const owner = colonyOwner(d);
  if (owner === null) return null;
  const capital = d.planets.some((p) => p.capital && p.owner === owner);
  return capital ? CAPITAL_PLATE_KEY : PLATE_KEY;
}

function planetShown(p: PlanetSummary): boolean {
  if (p.colonised) return false;
  if (p.habitable !== null) return p.habitable;
  return FALLBACK_HABITABLE.test(p.class);
}

/** The planets in the stack beside the star: habitable and still free, moons included. */
export function visiblePlanets(d: SystemDetails): PlanetSummary[] {
  return d.planets.filter(planetShown);
}

/** The first country holding a planet here that is not a pre-FTL civilisation. */
export function colonyOwner(d: SystemDetails): number | null {
  return d.planets.find((p) => p.owner !== null && !p.pre_ftl)?.owner ?? null;
}

/** Whose emblem sits left of the name: the coloniser, else a marauder clan holding the system. */
export function emblemOwner(
  d: SystemDetails,
  systemOwner: number | null,
  countries: ReadonlyMap<number, CountryNode>,
): number | null {
  const colony = colonyOwner(d);
  if (colony !== null) return colony;
  if (systemOwner !== null && isMarauder(countries.get(systemOwner))) return systemOwner;
  return null;
}
