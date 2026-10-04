import type { KindCount } from "../generated/KindCount";
import type { SpecialKind } from "../generated/SpecialKind";

/** What the app says and draws for one kind of special system. */
interface KindInfo {
  label: string;
  /** What the kind means in the game, for the chips and rows that name one. */
  description: string;
  /** Galaxy generation places it in a system before anything in the game uses it. */
  hidden: boolean;
  /** Rare and always worth a badge, even zoomed all the way out. */
  notable: boolean;
  /** The Points of interest tab's group, if the kind has one, listed in ascending `rank`. */
  point?: { label: string; rank: number };
  color: number;
  /** The texture key of the badge's icon. */
  icon: string;
}

const HORIZON_SIGNAL = "Horizon Signal";

/**
 * Every kind, in the order the backend counts them: `KIND_ORDER` in
 * `crates/sgf-gamedata/src/special.rs`. A new kind fails to compile until its row is written.
 */
export const SPECIAL_KINDS = {
  leviathan: {
    label: "Leviathan",
    description: "A guardian holds this system: a lone, very powerful creature or machine.",
    hidden: false,
    notable: true,
    point: { label: "Leviathans", rank: 0 },
    color: 0xff5533,
    icon: "symbol:pirate/flag_pirate_3.dds",
  },
  enclave: {
    label: "Enclave",
    description:
      "An enclave station trades here: traders, artists, curators, shroudwalkers or salvagers.",
    hidden: false,
    notable: true,
    point: { label: "Enclaves", rank: 1 },
    color: 0x2dd4bf,
    icon: "symbol:enclaves/enclaves_flag_curator.dds",
  },
  marauder: {
    label: "Marauder",
    description:
      "A marauder clan lives here, raiding its neighbours and hiring out as mercenaries.",
    hidden: false,
    notable: true,
    color: 0x9333ea,
    icon: "symbol:pirate/flag_pirate_5.dds",
  },
  holy_world: {
    label: "Holy world",
    description: "A fallen empire's holy world, which the Holy Guardians protect.",
    hidden: true,
    notable: true,
    point: { label: "Holy worlds", rank: 3 },
    color: 0xfacc15,
    icon: "symbol:special/the_empire.dds",
  },
  fallen_empire: {
    label: "Fallen empire",
    description: "A fallen empire's system: an ancient power that sits still until it awakens.",
    hidden: false,
    notable: true,
    color: 0xd4af37,
    icon: "symbol:special/the_empire.dds",
  },
  landmark: {
    label: "Landmark",
    description:
      "A galactic landmark: a sight the galaxy is built around, with a deposit of its own.",
    hidden: false,
    notable: true,
    point: { label: "Galactic landmarks", rank: 2 },
    color: 0x8b5cf6,
    icon: "sprite:GFX_point_of_interest_levels#1",
  },
  unique: {
    label: "Unique",
    description: "A hand-written system from the game or a mod, not one the galaxy generator made.",
    hidden: false,
    notable: false,
    point: { label: "Scripted systems", rank: 7 },
    color: 0x22c55e,
    icon: "symbol:pointy/flag_pointy_16.dds",
  },
  contingency: {
    label: "Contingency hub",
    description:
      "One of the four hubs every galaxy is built with. It is only used if the Contingency is the crisis.",
    hidden: true,
    notable: true,
    point: { label: "Contingency hubs", rank: 4 },
    color: 0xef4444,
    icon: "symbol:special/ai_01.dds",
  },
  horizon_signal: {
    label: HORIZON_SIGNAL,
    description: "The black hole the Horizon Signal event chain starts from.",
    hidden: true,
    notable: true,
    point: { label: HORIZON_SIGNAL, rank: 5 },
    color: 0x38bdf8,
    icon: "symbol:special/unknown.dds",
  },
  cutholoid: {
    label: "Cutholoid",
    description: "A Cutholoid hides in an asteroid here.",
    hidden: true,
    notable: false,
    point: { label: "Hidden Cutholoids", rank: 6 },
    color: 0xa3a3a3,
    icon: "symbol:zoological/flag_zoological_1.dds",
  },
} as const satisfies Record<SpecialKind, KindInfo>;

const info = (kind: SpecialKind): KindInfo => SPECIAL_KINDS[kind];

/** The kinds the Points of interest tab has a group for. */
export type PointKind = {
  [K in SpecialKind]: (typeof SPECIAL_KINDS)[K] extends { point: object } ? K : never;
}[SpecialKind];

/**
 * The order menus and lists put the kinds in, which is the order the backend counts them in:
 * the table's own.
 */
export const KIND_ORDER: SpecialKind[] = Object.keys(SPECIAL_KINDS) as SpecialKind[];

/** That order as the open document states it: one count per kind, in the core's order. */
export function kindOrder(counts: readonly KindCount[]): SpecialKind[] {
  return counts.length === 0 ? [...KIND_ORDER] : counts.map((c) => c.kind);
}

export function kindLabel(kind: SpecialKind): string {
  return info(kind).label;
}

/** What a chip or row naming `kind` says on hover. */
export function kindTitle(kind: SpecialKind): string {
  return `${info(kind).label}: ${info(kind).description}`;
}

/** The kind's colour on the map and in the lists that name it. */
export function kindColor(kind: SpecialKind): number {
  return info(kind).color;
}

/** The texture key of the kind's own icon. */
export function kindIcon(kind: SpecialKind): string {
  return info(kind).icon;
}

/** Whether the kind's badge shows even zoomed all the way out. */
export function kindNotable(kind: SpecialKind): boolean {
  return info(kind).notable;
}

/** The kinds the Points of interest tab lists, in its order. */
export const POINT_KINDS: readonly PointKind[] = KIND_ORDER.filter(
  (kind): kind is PointKind => info(kind).point !== undefined,
).sort((a, b) => SPECIAL_KINDS[a].point.rank - SPECIAL_KINDS[b].point.rank);

/** The heading of a kind's group on the Points of interest tab. */
export function pointLabel(kind: PointKind): string {
  return SPECIAL_KINDS[kind].point.label;
}

/** What each piece of hidden content in a system is, one line each, from its kinds. */
export function hiddenContentLines(kinds: readonly SpecialKind[]): string[] {
  return kinds.filter((kind) => info(kind).hidden).map(kindTitle);
}
