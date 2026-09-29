/** Where the details bar puts the name row, the plate behind it and the planets beside the star. */
import type { ArchaeologySite } from "../../generated/ArchaeologySite";
import type { CountryNode } from "../../generated/CountryNode";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { isMarauder } from "../countryKinds";
import type { Names } from "../names";
import { DETAIL_SCALE } from "../visual/labels";
import { STAR_BASE_PX, starDiameterPx } from "../visual/starSize";
import { empireFlagKey } from "./fleets";
import { CAPITAL_PLATE_KEY, PLATE_KEY } from "./icons";
import { anomalyName, FALLBACK_HABITABLE, isColony, shownMegastructures } from "./labels";

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
/** The plate past the name on each side. */
export const PLATE_PAD_PX = 3;
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
  return namePlateKey(d.planets.some((p) => p.capital && p.owner === owner));
}

function namePlateKey(capital: boolean): string {
  return capital ? CAPITAL_PLATE_KEY : PLATE_KEY;
}

/**
 * What a body's name adds with details shown: a colony's plate and owner's flag, and the icons
 * of its megastructures, dig sites, anomaly and pre-FTL civilisation.
 */
export interface BodyMarks {
  /** The plate under the name, the capital's on the owner's capital; null for a body that is not a colony. */
  readonly plate: string | null;
  /** The owner's flag texture key; null for a body that is not a colony, or an owner with no full flag. */
  readonly flag: string | null;
  /** The owner's capital, whose flag is ringed in gold. */
  readonly capital: boolean;
  readonly preFtl: boolean;
  /** The megastructures orbiting it, less the bypasses, which the galaxy's row leaves out too. */
  readonly megastructures: readonly MegastructureSummary[];
  readonly sites: readonly ArchaeologySite[];
  /** The name of the anomaly it holds; null for none. */
  readonly anomaly: string | null;
}

const NONE: readonly never[] = Object.freeze([]);

export const NO_MARKS: BodyMarks = Object.freeze({
  plate: null,
  flag: null,
  capital: false,
  preFtl: false,
  megastructures: NONE,
  sites: NONE,
  anomaly: null,
});
const PRE_FTL_MARKS: BodyMarks = Object.freeze({ ...NO_MARKS, preFtl: true });

/** The items of `items` on planet `id`. */
function onPlanet<T extends { planet: number | null }>(
  items: readonly T[],
  id: number,
): readonly T[] {
  const on = items.filter((item) => item.planet === id);
  return on.length === 0 ? NONE : on;
}

/** The marks a planet's name shows, as the system's name shows them for the planets in it. */
export function bodyMarks(
  p: PlanetSummary,
  countries: ReadonlyMap<number, CountryNode>,
  d: Pick<SystemDetails, "megastructures" | "sites">,
  names: Names,
): BodyMarks {
  const megastructures = onPlanet(shownMegastructures(d.megastructures), p.id);
  const sites = onPlanet(d.sites, p.id);
  const anomaly = p.anomaly ? anomalyName(p.anomaly, names) : null;
  const icons = { megastructures, sites, anomaly };
  const plain = megastructures.length === 0 && sites.length === 0 && anomaly === null;
  if (p.pre_ftl) return plain ? PRE_FTL_MARKS : { ...PRE_FTL_MARKS, ...icons };
  if (!isColony(p) || p.owner === null) return plain ? NO_MARKS : { ...NO_MARKS, ...icons };
  return {
    plate: namePlateKey(p.capital),
    flag: empireFlagKey(countries.get(p.owner)),
    capital: p.capital,
    preFtl: false,
    ...icons,
  };
}

export function sameMarks(a: BodyMarks, b: BodyMarks): boolean {
  return (
    a.plate === b.plate &&
    a.flag === b.flag &&
    a.capital === b.capital &&
    a.preFtl === b.preFtl &&
    a.anomaly === b.anomaly &&
    sameItems(
      a.megastructures,
      b.megastructures,
      (x, y) => x.id === y.id && x.kind === y.kind && x.owner === y.owner,
    ) &&
    sameItems(a.sites, b.sites, (x, y) => x.id === y.id && x.kind === y.kind)
  );
}

function sameItems<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((x, i) => same(x, b[i]));
}

/** Whether a body's name shows anything of `marks`. */
export function marked(marks: BodyMarks): boolean {
  return (
    marks.plate !== null ||
    marks.preFtl ||
    marks.megastructures.length > 0 ||
    marks.sites.length > 0 ||
    marks.anomaly !== null
  );
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
