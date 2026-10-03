/** Where the details bar puts the name row, the plate behind it and the planets beside the star. */
import type { CountryNode } from "../../generated/CountryNode";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { isMarauder } from "../countryKinds";
import type { Names } from "../names";
import { DETAIL_SCALE } from "../visual/labels";
import { STAR_BASE_PX, starDiameterPx } from "../visual/starSize";
import { empireFlagKey } from "./fleets";
import { CAPITAL_PLATE_KEY, PLATE_KEY } from "./icons";
import { FALLBACK_HABITABLE } from "./labels";
import {
  bodyIcons,
  type NameIconSlot,
  type NameIconSubject,
  nameIconSlots,
  sameSlots,
} from "./nameIcons";

/** Zoom (pixels per world unit) at which system details pop in: a wheel notch after the names. */
export const DETAILS_MIN_SCALE = DETAIL_SCALE * 1.1;

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
  return nameEmblem(d.planets, NO_COUNTRIES)?.plate ?? null;
}

const NO_COUNTRIES: ReadonlyMap<number, CountryNode> = new Map();

/** The flag left of a name, and the plate under it. */
export interface NameEmblem {
  readonly owner: number;
  /** The owner's flag texture key; null for an owner with no full flag. */
  readonly flag: string | null;
  /** The plate under the name, the capital's on the owner's capital; null where no colony is held. */
  readonly plate: string | null;
  /** The owner's capital is among the planets, and its flag is ringed in gold. */
  readonly capital: boolean;
}

/**
 * The emblem of whoever holds `planets`: the first country with a colony among them, else
 * `holder` where it is a marauder clan, whose flag shows with no plate. Null for neither.
 */
export function nameEmblem(
  planets: readonly PlanetSummary[],
  countries: ReadonlyMap<number, CountryNode>,
  holder: number | null = null,
): NameEmblem | null {
  const colony = colonyOwnerOf(planets);
  const owner = colony ?? (holder !== null && isMarauder(countries.get(holder)) ? holder : null);
  if (owner === null) return null;
  const capital = planets.some((p) => p.capital && p.owner === owner);
  return {
    owner,
    flag: empireFlagKey(countries.get(owner)),
    plate: colony === null ? null : capital ? CAPITAL_PLATE_KEY : PLATE_KEY,
    capital,
  };
}

function sameEmblem(a: NameEmblem | null, b: NameEmblem | null): boolean {
  if (a === null || b === null) return a === b;
  return a.owner === b.owner && a.flag === b.flag && a.plate === b.plate && a.capital === b.capital;
}

/** What a body's name adds with details shown: its owner's flag and plate, and its icons. */
export interface BodyMarks {
  /** On a colony; null for any other body. */
  readonly emblem: NameEmblem | null;
  readonly icons: NameIconSubject;
  /** The icons `icons` draws. */
  readonly slots: readonly NameIconSlot[];
}

const NONE: readonly never[] = Object.freeze([]);

export const NO_MARKS: BodyMarks = Object.freeze({
  emblem: null,
  icons: Object.freeze({
    planets: NONE,
    megastructures: NONE,
    bypasses: NONE,
    sites: NONE,
    anomaly: null,
  }),
  slots: NONE,
});

/** The marks a planet's name shows, as the system's name shows them for the planets in it. */
export function bodyMarks(
  p: PlanetSummary,
  countries: ReadonlyMap<number, CountryNode>,
  d: Pick<SystemDetails, "megastructures" | "sites">,
  names: Names,
): BodyMarks {
  const icons = bodyIcons(p, d, names);
  return { emblem: nameEmblem([p], countries), icons, slots: nameIconSlots(icons) };
}

/** Whether both draw the same flag, plate and icons, so a label laid out for one fits the other. */
export function sameMarks(a: BodyMarks, b: BodyMarks): boolean {
  return sameEmblem(a.emblem, b.emblem) && sameSlots(a.slots, b.slots);
}

/** Whether a body's name shows anything of `marks`. */
export function marked(marks: BodyMarks): boolean {
  return marks.emblem !== null || marks.slots.length > 0;
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
  return colonyOwnerOf(d.planets);
}

function colonyOwnerOf(planets: readonly PlanetSummary[]): number | null {
  return planets.find((p) => p.owner !== null && !p.pre_ftl)?.owner ?? null;
}
