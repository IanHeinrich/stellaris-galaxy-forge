import type { KindCount } from "../generated/KindCount";
import type { SpecialKind } from "../generated/SpecialKind";

/** In the core's `KIND_ORDER`; the record is exhaustive, so a new kind cannot be missed. */
const LABELS: Record<SpecialKind, string> = {
  leviathan: "Leviathan",
  enclave: "Enclave",
  marauder: "Marauder",
  holy_world: "Holy world",
  fallen_empire: "Fallen empire",
  landmark: "Landmark",
  contingency: "Contingency hub",
  horizon_signal: "Horizon Signal",
  cutholoid: "Cutholoid",
  unique: "Unique",
};

/** What each kind means in the game, for the chips and rows that name one. */
const DESCRIPTIONS: Record<SpecialKind, string> = {
  leviathan: "A guardian holds this system: a lone, very powerful creature or machine.",
  enclave:
    "An enclave station trades here: traders, artists, curators, shroudwalkers or salvagers.",
  marauder: "A marauder clan lives here, raiding its neighbours and hiring out as mercenaries.",
  holy_world: "A fallen empire's holy world, which the Holy Guardians protect.",
  fallen_empire: "A fallen empire's system: an ancient power that sits still until it awakens.",
  landmark: "A galactic landmark: a sight the galaxy is built around, with a deposit of its own.",
  contingency:
    "One of the four hubs every galaxy is built with. It is only used if the Contingency is the crisis.",
  horizon_signal: "The black hole the Horizon Signal event chain starts from.",
  cutholoid: "A Cutholoid hides in an asteroid here.",
  unique: "A hand-written system from the game or a mod, not one the galaxy generator made.",
};

/**
 * The order menus and lists put the kinds in, which is the order the backend counts them in:
 * `KIND_ORDER` in `crates/sgf-gamedata/src/special.rs`.
 */
export const KIND_ORDER: SpecialKind[] = [
  "leviathan",
  "enclave",
  "marauder",
  "holy_world",
  "fallen_empire",
  "landmark",
  "unique",
  "contingency",
  "horizon_signal",
  "cutholoid",
];

/** That order as the open document states it: one count per kind, in the core's order. */
export function kindOrder(counts: readonly KindCount[]): SpecialKind[] {
  return counts.length === 0 ? [...KIND_ORDER] : counts.map((c) => c.kind);
}

export function kindLabel(kind: SpecialKind): string {
  return LABELS[kind];
}

/** What a chip or row naming `kind` says on hover. */
export function kindTitle(kind: SpecialKind): string {
  return `${LABELS[kind]}: ${DESCRIPTIONS[kind]}`;
}

/** Kinds galaxy generation places in a system before anything in the game uses them. */
const HIDDEN_KINDS: ReadonlySet<SpecialKind> = new Set([
  "holy_world",
  "contingency",
  "horizon_signal",
  "cutholoid",
]);

/** What each piece of hidden content in a system is, one line each, from its kinds. */
export function hiddenContentLines(kinds: readonly SpecialKind[]): string[] {
  return kinds.filter((kind) => HIDDEN_KINDS.has(kind)).map(kindTitle);
}
