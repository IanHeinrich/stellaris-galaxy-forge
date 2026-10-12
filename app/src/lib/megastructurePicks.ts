/**
 * What the Add megastructure dialog offers at a spot of the system view: the megastructures the
 * editor adds there, each with its stages, and where the new row stands.
 */
import { RELAY_RADIUS_FACTOR } from "../generated/constants";
import type { MegastructurePlace } from "../generated/MegastructurePlace";
import type { MegastructureSummary } from "../generated/MegastructureSummary";
import type { MegastructureView } from "../generated/MegastructureView";
import type { PlanetSummary } from "../generated/PlanetSummary";
import { megastructureLabel } from "./details/labels";
import { isRingRow, isRingSegment } from "./details/ringWorldRemoval";
import {
  chainVariants,
  swappedTypes,
  swapsByStarClass,
  type SwapContext,
} from "./megastructureVariants";
import { orbitText, placementAt } from "./planetMove";

export { RELAY_RADIUS_FACTOR };

export const ADD_MEGASTRUCTURE_HERE_LABEL = "Add megastructure here…";
export const ADD_MEGASTRUCTURE_LABEL = "Add megastructure…";
export const MEGASTRUCTURES_NEED_GAME_DATA = "Load game data to add a megastructure.";
export const BODY_HAS_MEGASTRUCTURE = "It already has a megastructure.";
export const NO_MEGASTRUCTURE_FITS = "No megastructure the game data defines can go here.";

/** What the dialog says before Add. */
export const WRITTEN_FINISHED = "The megastructure is added finished.";
/**
 * What the dialog says before Add of a type whose finished stage is a habitat, in a system an
 * empire owns when `owned`.
 */
export function writtenAsHabitat(owned: boolean): string {
  const skin = owned
    ? "It has the habitat skin of the empire that owns the system."
    : "No one owns the system, so it has the habitat class's default skin.";
  return `The habitat is added finished, as a planet with no colony. ${skin}`;
}
/** What the dialog says of a habitat's owner. */
export const HABITAT_OWNER_NOTE = "A habitat is added with no owner.";
/** What the dialog says of the owner of the major orbital that comes with a habitat. */
export const HABITAT_ORBITAL_OWNER_NOTE =
  "Its major orbital goes to the empire that owns the system.";
/** Why a habitat comes with no major orbital. */
export const HABITAT_ORBITAL_HOST_TAKEN =
  "Its host already has a megastructure, so no major orbital is added.";
/**
 * What the dialog says of the major orbital that comes with a habitat, in a system an empire
 * owns when `owned`, and `hostTaken` when the habitat's host holds a megastructure already.
 */
export function habitatOrbitalNote(owned: boolean, hostTaken: boolean): string {
  if (hostTaken) return HABITAT_ORBITAL_HOST_TAKEN;
  const owner = owned ? "owned by the empire that owns the system" : "with no owner";
  return `A major orbital is added at its host, ${owner}.`;
}
/** Whether `spot` is a body that a row of `rows` stands at. */
export function hostHasMegastructure(
  spot: MegastructureSpot,
  rows: readonly MegastructureSummary[],
): boolean {
  return spot.kind === "body" && rows.some((row) => row.planet === spot.body);
}
/** Why no habitat goes round a body. */
export const HABITAT_ROUND_SATELLITE =
  "It orbits a planet, and Galaxy Forge puts no habitat round a body that orbits a planet.";

/**
 * Where in the system view the Add megastructure menu was opened: on a body, with its class when
 * known, or in empty space.
 */
export type MegastructureSpot =
  | {
      readonly kind: "body";
      readonly body: number;
      readonly star: boolean;
      readonly class?: string | null;
      /** The body orbits a planet, as a moon or a habitat does: no habitat goes round it. */
      readonly orbitsPlanet?: boolean;
    }
  | { readonly kind: "space"; readonly x: number; readonly y: number };

/** What the dialog says of a type it lists but cannot add yet. */
export const CHANGES_BODY = "Changes the planet's class, which Galaxy Forge can't add yet.";
export const WHOLE_STRUCTURE =
  "Builds more planets or sections with it, which Galaxy Forge can't add yet.";

/** Why the dialog lists a type it cannot add, greyed out; null for one it adds or never lists. */
function greyedOut(type: MegastructureView): string | null {
  const { placement } = type;
  if (placement.place !== "unsupported") return null;
  if (placement.why.kind === "changes_body") return CHANGES_BODY;
  if (placement.why.kind === "whole_structure") return WHOLE_STRUCTURE;
  return null;
}

/** Whether a type is a stage of a ring world past its site, which the dialog adds as the whole ring. */
export function isRingWorld(type: MegastructureView): boolean {
  return type.placement.place === "unsupported" && type.placement.why.kind === "ring_world";
}

/** What the dialog calls a ring world, its tile that adds the whole ring, and the list's summary of it. */
export const RING_WORLD_LABEL = "Ring World";
export const RING_STAGE = "Ring";
export const RING_WORLD_SUMMARY = "Site or whole ring";

/** Why a ring world whose chain the game data lays out no ring for is greyed out. */
export function ringLayoutRefusal(reason: string): string {
  return `Galaxy Forge can't build this ring world from the game data: ${reason}.`;
}

export const RING_WORLD_NO_STAR = "The system has no star for a ring world to stand round.";
export const RING_WORLD_THERE = "The system already has a ring world or a ring world site.";

/**
 * Why the save would refuse a whole ring world in a system of `planets` and `rows`, as the core
 * refuses it: a system with other than one star, and one that has a ring world or its site
 * already. Null when it fits.
 */
export function ringWorldRefusal(
  planets: readonly PlanetSummary[],
  rows: readonly MegastructureSummary[],
): string | null {
  const stars = planets.filter((p) => p.role === "primary" || p.role === "star").length;
  if (stars === 0) return RING_WORLD_NO_STAR;
  if (stars > 1) return `The system has ${stars} stars, and a ring world stands round one.`;
  if (planets.some((p) => isRingSegment(p.class)) || rows.some((row) => isRingRow(row.kind))) {
    return RING_WORLD_THERE;
  }
  return null;
}

/** Whether a type goes at `spot`: a free point in empty space, a body on a body. */
function fits(type: MegastructureView, spot: MegastructureSpot): boolean {
  const { placement } = type;
  if (spot.kind === "space") return placement.place === "free";
  if (placement.place === "body") return spot.star ? !type.planet_only : !placement.star_only;
  if (placement.place !== "unsupported") return false;
  const { why } = placement;
  if (why.kind === "changes_body") return true;
  if (why.kind === "whole_structure") return !why.star_only || spot.star;
  if (why.kind === "ring_world") return spot.star;
  return false;
}

const VARIANT = /_(permanently_ruined|ruined|restored|destroyed|derelict)(_|$)/;
const VARIANT_WORDS = new Set(["permanently", "ruined", "restored", "destroyed", "derelict"]);

/** Whether a type is a ruined, restored, destroyed or derelict variant of a working one. */
function isVariant(type: MegastructureView): boolean {
  return type.variant_of !== null || VARIANT.test(type.key);
}

/** Whether the game data says the dialog leaves a type out, whatever the save. */
const offerHidden = (type: MegastructureView) => type.offer.offer === "hidden";

/** One stage the dialog offers, as a tile. */
export interface MegastructureStage {
  key: string;
  /** Its localised name, else the words of its key; with what tells it apart in brackets when
   * another stage of its megastructure has the same name. */
  label: string;
  /** Its name without the megastructure's: `Site`, `Nascency`, `Finished`. */
  short: string;
  /** Its place in its row, from 1. */
  index: number;
  /** How many stages its row has. */
  count: number;
  /** Why it can't be added here, such as a second relay in the system; null when it fits. */
  refused: string | null;
  /**
   * The type Add writes: the one the game swaps this stage for at the spot, such as a B-class
   * star's Dyson Swarm, else `key`.
   */
  variant: string;
  /** The tile that adds a ring world whole, with each quadrant at its own stage. */
  ring?: boolean;
}

/**
 * What a row of a megastructure holds: its build chain, the ruined and restored versions, a
 * variant's chain, such as one star class's or one an event builds, or a ring world's site and
 * whole ring.
 */
export type MegastructureRowKind = "build" | "ruins" | "variant" | "ring";

/** One chain of a megastructure, as a row of tiles. */
export interface MegastructureChain {
  /** What tells the row apart from the megastructure's other rows; null for a megastructure of one. */
  label: string | null;
  kind: MegastructureRowKind;
  /** The key of its first stage. */
  first: string;
  /** Its stages in chain order. */
  stages: MegastructureStage[];
  /** How many of `stages` are working stages. */
  working: number;
  /** The key of its finished stage: its last working one, else its last. */
  finished: string;
}

/** One megastructure as the player knows it, as the dialog's list shows it. */
export interface MegastructureEntry {
  /** Its section and name, unique in the list. */
  key: string;
  /** The localised name of its main chain's finished stage. */
  label: string;
  /** The mod it comes from; null for the base game's. */
  section: string | null;
  /** No type of it has a localised name: the list shows it only to a filter on its keys, last
   * in its section. */
  unnamed: boolean;
  /** How many stages its build chain has and what other rows it has: `4 stages · 2 variants`. */
  summary: string;
  chains: MegastructureChain[];
}

/** How many stages come before `key` in its chain, by the longest way back through `upgrade_from`. */
function stageOf(
  key: string,
  types: ReadonlyMap<string, MegastructureView>,
  known: Map<string, number>,
): number {
  const found = known.get(key);
  if (found !== undefined) return found;
  known.set(key, 0);
  const earlier = (types.get(key)?.upgrade_from ?? []).filter((from) => types.has(from));
  const stage = Math.max(-1, ...earlier.map((from) => stageOf(from, types, known))) + 1;
  known.set(key, stage);
  return stage;
}

/** The first of `type`'s `upgrade_from` that `pool` holds: the stage it is built over. */
function builtOver(type: MegastructureView, pool: ReadonlySet<string>): string | null {
  return type.upgrade_from.find((from) => pool.has(from)) ?? null;
}

/**
 * The groups `types` join into: each type with the stage it is built over, the working type it
 * is a variant of, and the types its build turns into. A later `upgrade_from`, such as a Dyson
 * Sphere stage built over a finished Dyson Swarm, joins nothing.
 */
function linked(types: ReadonlyMap<string, MegastructureView>): MegastructureView[][] {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    let at = key;
    while (parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  const join = (a: string | null, b: string | null) => {
    if (a === null || b === null || !types.has(a) || !types.has(b)) return;
    const [x, y] = [root(a), root(b)];
    if (x !== y) parent.set(x, y);
  };
  const keys = new Set(types.keys());
  for (const key of keys) parent.set(key, key);
  for (const type of types.values()) {
    join(type.key, builtOver(type, keys));
    join(type.key, type.variant_of);
    for (const into of type.turns_into) join(type.key, into);
  }
  const groups = new Map<string, MegastructureView[]>();
  for (const type of types.values()) {
    const group = groups.get(root(type.key));
    if (group) group.push(type);
    else groups.set(root(type.key), [type]);
  }
  return [...groups.values()];
}

/** A key's words with stage numbers left out: `ehof_megastructure_phase0` → ehof megastructure phase. */
function stemWords(key: string): string[] {
  return key
    .split("_")
    .map((word) => word.replace(/\d+$/, ""))
    .filter((word) => word !== "");
}

const stem = (key: string) => stemWords(key).join("_");

/** A ruin's stem without its variant words: `dyson_sphere_ruined_b_star` → dyson_sphere_b_star. */
const bareStem = (key: string) =>
  stemWords(key)
    .filter((word) => !VARIANT_WORDS.has(word))
    .join("_");

/** `o star` → `O-class star`, `scaling` → `Scaling`; `Standard` for no words. */
function keyWords(words: readonly string[]): string {
  if (words.length === 0) return "Standard";
  const [head, ...rest] = words;
  if (head.length === 1 && rest.length > 0) {
    return [`${head.toUpperCase()}-class`, ...rest].join(" ");
  }
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `words` past the ones it shares, from the start, with `other`. */
function pastShared(words: readonly string[], other: readonly string[]): string[] {
  let shared = 0;
  while (shared < words.length && words[shared] === other[shared]) shared++;
  return words.slice(shared);
}

interface Row {
  kind: MegastructureRowKind;
  keys: string[];
  label: string | null;
  /** For a ruins row, the label of the variant row whose star class or kind it shares. */
  attached: string | null;
  /** For a ruins row, what tells it apart from the others of its kind. */
  part?: string;
}

/** Whether a row holds only types the game makes from script and no localisation names. */
function isInternal(
  row: Row,
  types: ReadonlyMap<string, MegastructureView>,
  named: (key: string) => boolean,
): boolean {
  return row.keys.every((key) => types.get(key)!.script_only && !named(key));
}

/**
 * The rows of one group, its main build chain first: from the first stage, each next stage
 * built over it with the same key words and built as a player builds it. Then each other
 * working chain, then each chain of ruined and restored versions.
 */
function groupRows(
  group: readonly MegastructureView[],
  byStage: (a: MegastructureView, b: MegastructureView) => number,
  order: ReadonlyMap<string, number>,
): Row[] {
  const working = group.filter((type) => !isVariant(type)).sort(byStage);
  const variants = group.filter(isVariant).sort(byStage);
  const turnedInto = new Set(group.flatMap((type) => type.turns_into));
  const placed = new Set<string>();
  const chainFrom = (
    start: MegastructureView,
    pool: readonly MegastructureView[],
    main: boolean,
  ): string[] => {
    const keys = new Set(pool.map((type) => type.key));
    const row = [start.key];
    placed.add(start.key);
    for (let at = start; ;) {
      const next = pool.filter((type) => !placed.has(type.key) && builtOver(type, keys) === at.key);
      const same = next.filter((type) => stem(type.key) === stem(at.key) && !type.script_only);
      const pick = same[0] ?? (main && row.length > 1 ? undefined : next[0]);
      if (pick === undefined || (main && pick.script_only)) return row;
      row.push(pick.key);
      placed.add(pick.key);
      at = pick;
    }
  };
  const rows: Row[] = [];
  const workingKeys = new Set(working.map((type) => type.key));
  const roots = working
    .filter((type) => builtOver(type, workingKeys) === null)
    .sort(
      (a, b) =>
        Number(a.upgrade_from.length > 0) - Number(b.upgrade_from.length > 0) ||
        Number(a.script_only) - Number(b.script_only) ||
        Number(turnedInto.has(a.key)) - Number(turnedInto.has(b.key)) ||
        stemWords(a.key).length - stemWords(b.key).length ||
        order.get(a.key)! - order.get(b.key)!,
    );
  if (roots.length > 0) {
    rows.push({
      kind: "build",
      keys: chainFrom(roots[0], working, true),
      label: null,
      attached: null,
    });
  }
  for (const type of working) {
    if (placed.has(type.key)) continue;
    rows.push({
      kind: "variant",
      keys: chainFrom(type, working, false),
      label: null,
      attached: null,
    });
  }
  const ruins: Row[] = [];
  for (const type of variants) {
    if (placed.has(type.key)) continue;
    ruins.push({
      kind: "ruins",
      keys: chainFrom(type, variants, false),
      label: null,
      attached: null,
    });
  }
  ruins.sort((a, b) => a.keys[0].split("_").length - b.keys[0].split("_").length);
  return [...rows, ...ruins];
}

/** A localised name without the zero-width spaces some mods pad it with. */
export const cleanName = (name: string) => name.replace(/\u200b/g, "").trim();

const plainWords = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word !== "");

/**
 * `name` without the megastructure's name `family`, when it holds all of its words or two of
 * them in a row: `Dyson Sphere Site` → `Site`, `Art Installation: Nascency` → `Nascency`.
 */
function shortName(name: string, family: string): string {
  const own = name.split(/\s+/).filter((word) => word !== "");
  const theirs = plainWords(family);
  const holds = own.map((word) => theirs.includes(plainWords(word)[0] ?? ""));
  const run = holds.some((held, i) => held && holds[i + 1]);
  const all = theirs.every((word) => own.some((w) => plainWords(w)[0] === word));
  if (!run && !all) return name;
  const left = own
    .filter((_, i) => !holds[i])
    .join(" ")
    .replace(/^[\s:,–-]+|[\s:,–-]+$/g, "");
  return left === "" ? "" : left.charAt(0).toUpperCase() + left.slice(1);
}

/** The variant words of `key`, as the player says them: `permanently_ruined` → Permanently ruined. */
function variantWords(key: string): string {
  return keyWords(key.split("_").filter((word) => VARIANT_WORDS.has(word)));
}

/** Whether `label` names a star class: `O-class star`, `M-class giant star`. */
const starClass = (label: string) => /^[A-Z]-class\b/.test(label);

/**
 * Labels `rows`, the rows of one megastructure named `family`, each told apart from the others:
 * a star class from its keys, else the localised name of its finished stage, else the words of
 * its keys that differ.
 */
function labelRows(
  rows: Row[],
  family: string,
  nameOf: (key: string) => string,
  named: (key: string) => boolean,
): void {
  if (rows.length < 2) return;
  const [main] = rows;
  const variants = rows.filter((row) => row.kind === "variant");
  const firsts = [main, ...variants].map((row) => stemWords(row.keys[0]));
  const shared = firsts[0].filter((word, i) => firsts.every((w) => w[i] === word)).length;
  const own = (row: Row) => keyWords(stemWords(row.keys[0]).slice(shared));
  main.label = starClass(own(main)) ? own(main) : family;
  const mainWords = stemWords(main.keys[0]);
  const leafName = (row: Row) => {
    const leaf = row.keys[row.keys.length - 1];
    return named(leaf) ? nameOf(leaf) : null;
  };
  const leafNames = variants.map(leafName);
  for (const row of variants) {
    const fromKeys = keyWords(pastShared(stemWords(row.keys[0]), mainWords));
    const name = leafName(row);
    const unique = name !== null && leafNames.filter((n) => n === name).length === 1;
    if (!starClass(fromKeys) && unique && name !== family) row.label = name;
    else row.label = stemWords(row.keys[0]).length > shared ? fromKeys : nameOf(row.keys[0]);
  }
  const ruins = rows.filter((row) => row.kind === "ruins");
  for (const row of ruins) {
    const root = row.keys[0];
    const bare = stemWords(root)
      .filter((word) => !VARIANT_WORDS.has(word))
      .join("_");
    const owner =
      stem(main.keys[0]) === bare
        ? undefined
        : variants.find((other) => stem(other.keys[0]) === bare);
    row.attached = owner?.label ?? null;
    row.label = owner ? `${variantWords(root)} (${owner.label})` : variantWords(root);
  }
  const byLabel = new Map<string, Row[]>();
  for (const row of ruins) byLabel.set(row.label!, [...(byLabel.get(row.label!) ?? []), row]);
  for (const same of byLabel.values()) {
    if (same.length < 2) continue;
    const words = same.map((row) => stemWords(row.keys[0]));
    const common = words[0].filter((word) => words.every((w) => w.includes(word)));
    for (const row of same) {
      const part = stemWords(row.keys[0]).filter((word) => !common.includes(word));
      if (part.length === 0) continue;
      row.part = keyWords(part);
      row.label = `${row.label} (${row.part})`;
    }
  }
  const seen = new Map<string, number>();
  for (const row of rows) {
    const label = row.label!;
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    if (count > 1) row.label = `${label} (${count})`;
  }
}

/** Each stage's title, unique in its megastructure: its name, then what tells it apart. */
function stageTitles(rows: readonly Row[], nameOf: (key: string) => string): Map<string, string> {
  const titles = new Map<string, string>();
  const byName = new Map<string, { key: string; row: Row; index: number }[]>();
  for (const row of rows) {
    row.keys.forEach((key, index) => {
      const name = nameOf(key);
      titles.set(key, name);
      const same = byName.get(name);
      if (same) same.push({ key, row, index });
      else byName.set(name, [{ key, row, index }]);
    });
  }
  for (const [name, same] of byName) {
    if (same.length < 2) continue;
    const keeper =
      same.find((s) => s.row === rows[0]) ??
      (same.every((s) => s.row.kind === "variant")
        ? null
        : [...same].sort((a, b) => a.key.split("_").length - b.key.split("_").length)[0]);
    const words = same.map((s) => s.key.split("_"));
    const common = words[0].filter((word) => words.every((w) => w.includes(word)));
    const named = plainWords(name);
    for (const s of same) {
      if (s === keeper) continue;
      const own = s.key.split("_").filter((word) => !common.includes(word));
      const state = variantWords(s.key);
      const stated = plainWords(state).every((word) => named.includes(word));
      const tag = s.row.attached ?? s.row.part;
      let part: string;
      if (s.row === keeper?.row) {
        part = own.every((word) => /^\d+$/.test(word)) ? `Stage ${s.index + 1}` : keyWords(own);
      } else if (s.row.kind === "variant" && s.row.label !== null && s.row.label !== name) {
        part = s.row.label;
      } else if (s.row.kind === "ruins") {
        part = tag === undefined ? state : stated ? tag : `${tag}, ${state.toLowerCase()}`;
      } else {
        part = keyWords(own);
      }
      titles.set(s.key, `${name} (${part})`);
    }
  }
  const taken = new Map<string, number>();
  for (const [key, title] of titles) {
    const count = (taken.get(title) ?? 0) + 1;
    taken.set(title, count);
    if (count > 1) titles.set(key, `${title} (${key})`);
  }
  return titles;
}

/**
 * `4 stages · by star class`, `4 stages · 2 variants · ruins`. By star class when the main
 * chain's completion swaps by the star's class, or most other rows are a star class's.
 */
function summaryOf(rows: readonly Row[], swapsByClass: boolean): string {
  const stages = rows[0].keys.length;
  const parts = [`${stages} ${stages === 1 ? "stage" : "stages"}`];
  const variants = rows.filter((row) => row.kind === "variant");
  const starClass = variants.filter((row) => /-class/i.test(row.label ?? "")).length;
  const classRows = starClass > 0 && starClass * 2 >= variants.length ? starClass : 0;
  if (swapsByClass || classRows > 0) parts.push("by star class");
  const others = variants.length - classRows;
  if (others > 0) parts.push(`${others} ${others === 1 ? "variant" : "variants"}`);
  if (rows.some((row) => row.kind === "ruins")) parts.push("ruins");
  return parts.join(" · ");
}

/**
 * The rows of one group the dialog shows: none when the game data offers no stage of its main
 * chain, else each row without its hidden stages, and without a row left empty.
 */
function shownRows(
  rows: readonly Row[],
  types: ReadonlyMap<string, MegastructureView>,
): Row[] | null {
  const hidden = (key: string) => offerHidden(types.get(key)!);
  if (rows[0].keys.every(hidden)) return null;
  return rows
    .map((row) => ({ ...row, keys: row.keys.filter((key) => !hidden(key)) }))
    .filter((row) => row.keys.length > 0);
}

/** What the list asks of the save besides the spot. */
export interface MegastructureEntriesOptions {
  /** The save's global flags, such as Gigastructural Engineering's settings. They pick the
   * variant a swap writes and never hide a type. */
  globalFlags?: ReadonlySet<string>;
}

const NO_FLAGS: ReadonlySet<string> = new Set();

/**
 * The megastructures that go at `spot`. Each is a group of types joined by the stages they are
 * built over, the working type a ruin belongs to and the type a build turns into, and the groups
 * of one name in one section are one megastructure. Its main build chain names it and comes
 * first, then its other chains, then its ruined and restored versions. The base game's come
 * first, then each mod's under its name, each section by name, and a mod's unnamed types last.
 * A type whose placement can never go at `spot` is left out, and so is one the editor does not
 * add, unless it only changes its planet or builds a whole structure: those are listed greyed
 * out with the reason. A ring world's stages past its site are one Ring tile after the site,
 * which adds the ring whole, greyed out with the reason when the game data lays out no ring for
 * it or `refusalOf` refuses it. A row of a megastructure whose types are all made from
 * script and have no localised name, such as the Gateway family's `blokkat_dummy_mega`, is left
 * out. `refusalOf` says why the save would refuse a type that does fit.
 *
 * A type the game data does not offer is left out. The save's global flags in `options` never
 * hide a type; they decide which variant a swap writes. A type the game makes only by swapping a
 * finished row, such as a star class's Dyson Sphere, is not listed: the stage it is swapped from
 * is, and its `variant` is the type the game makes of it at `spot`. The ruins of a star class's
 * chain go with it.
 */
export function megastructureEntries(
  types: ReadonlyMap<string, MegastructureView>,
  names: ReadonlyMap<string, string>,
  spot: MegastructureSpot,
  refusalOf: (type: MegastructureView) => string | null = () => null,
  { globalFlags = NO_FLAGS }: MegastructureEntriesOptions = {},
): MegastructureEntry[] {
  const named = (key: string) => cleanName(names.get(key) ?? "") !== "";
  const nameOf = (key: string) =>
    named(key) ? cleanName(names.get(key)!) : megastructureLabel(key);
  const swapped = swappedTypes(types);
  const classStems = new Set([...swappedTypes(types, true)].map(stem));
  const listed = (type: MegastructureView) =>
    fits(type, spot) &&
    !swapped.has(type.key) &&
    !(isVariant(type) && classStems.has(bareStem(type.key)));
  const fitting = new Map([...types].filter(([, type]) => listed(type)));
  const at: SwapContext = {
    starClass: spot.kind === "body" ? (spot.class ?? null) : null,
    globalFlags,
  };
  const variants = new Map<string, string>();
  const known = new Map<string, number>();
  const order = new Map([...types.keys()].map((key, i) => [key, i]));
  const byStage = (a: MegastructureView, b: MegastructureView) =>
    stageOf(a.key, types, known) - stageOf(b.key, types, known) ||
    order.get(a.key)! - order.get(b.key)!;
  const families = new Map<
    string,
    {
      label: string;
      section: string | null;
      unnamed: boolean;
      byClass: boolean;
      rows: Row[];
      ring: string | null;
    }
  >();
  for (const group of linked(fitting)) {
    const built = groupRows(group, byStage, order);
    const shown = shownRows(built, types);
    if (shown === null) continue;
    for (const row of built) {
      const made = chainVariants(row.keys, types, at);
      row.keys.forEach((key, i) => variants.set(key, made[i]));
    }
    const byClass = swapsByStarClass(built[0].keys, types);
    const ring = shown.flatMap((row) => row.keys).find((k) => isRingWorld(types.get(k)!)) ?? null;
    if (ring !== null) {
      const top = fitting.get(ring)!;
      const section = top.base_game ? null : top.source;
      const rows = shown
        .map((row) => ({ ...row, keys: row.keys.filter((k) => !isRingWorld(types.get(k)!)) }))
        .filter((row) => row.keys.length > 0);
      const key = `${section ?? ""}/${RING_WORLD_LABEL}`;
      const family = families.get(key);
      if (!family) {
        const label = RING_WORLD_LABEL;
        families.set(key, { label, section, unnamed: false, byClass: false, rows, ring });
        continue;
      }
      family.rows.push(...rows);
      family.rows.sort((a, b) => Number(a.kind !== "build") - Number(b.kind !== "build"));
      const laidOut = (k: string | null) => k !== null && types.get(k)!.ring_world_refused === null;
      if (!laidOut(family.ring) && laidOut(ring)) family.ring = ring;
      continue;
    }
    const [mainRow, ...otherRows] = shown;
    const rows = [mainRow, ...otherRows.filter((row) => !isInternal(row, types, named))];
    const main = rows[0].keys;
    const finished = main[main.length - 1];
    const unnamed = !group.some((type) => named(type.key));
    const namedStage = [...main].reverse().find(named) ?? group.map((t) => t.key).find(named);
    const label = unnamed ? megastructureLabel(stem(finished)) : nameOf(namedStage ?? finished);
    const top = fitting.get(finished)!;
    const section = top.base_game ? null : top.source;
    const key = `${section ?? ""}/${unnamed ? `?${stem(finished)}` : label}`;
    const family = families.get(key);
    if (!family) {
      families.set(key, { label, section, unnamed, byClass, rows, ring: null });
      continue;
    }
    family.byClass ||= byClass;
    const [first, ...rest] = rows;
    family.rows.push({ ...first, kind: "variant" }, ...rest);
    family.rows.sort((a, b) => Number(a.kind === "ruins") - Number(b.kind === "ruins"));
  }
  const entries: MegastructureEntry[] = [];
  for (const [key, family] of families) {
    const { label, section, unnamed, byClass, rows, ring } = family;
    labelRows(rows, label, nameOf, named);
    const titles = stageTitles(rows, nameOf);
    const chains = rows.map((row): MegastructureChain => {
      const working = row.keys.filter((k) => !isVariant(types.get(k)!)).length;
      const shorts = row.keys.map((k, i) => {
        const short = shortName(nameOf(k), label);
        if (short !== "") return short;
        if (isVariant(types.get(k)!)) return variantWords(k);
        return i === row.keys.length - 1 ? FINISHED : `Stage ${i + 1}`;
      });
      return {
        label: row.label,
        kind: row.kind,
        first: row.keys[0],
        stages: row.keys.map((k, i) => ({
          key: k,
          label: titles.get(k)!,
          short:
            shorts.indexOf(shorts[i]) === shorts.lastIndexOf(shorts[i])
              ? shorts[i]
              : `${shorts[i]} (${i + 1})`,
          index: i + 1,
          count: row.keys.length,
          refused: greyedOut(types.get(k)!) ?? refusalOf(types.get(k)!),
          variant: variants.get(k) ?? k,
        })),
        working,
        finished: row.keys[Math.max(working, 1) - 1],
      };
    });
    if (ring !== null) {
      const type = types.get(ring)!;
      const refused =
        type.ring_world_refused === null
          ? refusalOf(type)
          : ringLayoutRefusal(type.ring_world_refused);
      const withRing = ringChains(chains, ring, refused);
      entries.push({ key, label, section, unnamed, summary: RING_WORLD_SUMMARY, chains: withRing });
      continue;
    }
    entries.push({ key, label, section, unnamed, summary: summaryOf(rows, byClass), chains });
  }
  return entries.sort(
    (a, b) =>
      Number(a.unnamed) - Number(b.unnamed) ||
      Number(a.section !== null) - Number(b.section !== null) ||
      (a.section ?? "").localeCompare(b.section ?? "") ||
      a.label.localeCompare(b.label),
  );
}

/**
 * A ring world's rows with the Ring tile, which adds the ring whole, after its site in the first
 * row; the dialog opens the megastructure on the Ring tile.
 */
function ringChains(
  chains: readonly MegastructureChain[],
  ring: string,
  refused: string | null,
): MegastructureChain[] {
  const [first, ...rest] = chains;
  const site = first?.kind === "build" ? first.stages : [];
  const count = site.length + 1;
  const stage: MegastructureStage = {
    key: ring,
    label: RING_WORLD_LABEL,
    short: RING_STAGE,
    index: count,
    count,
    refused,
    variant: ring,
    ring: true,
  };
  const row: MegastructureChain = {
    label: null,
    kind: "ring",
    first: site[0]?.key ?? ring,
    stages: [...site.map((s) => ({ ...s, count })), stage],
    working: count,
    finished: ring,
  };
  return [row, ...(first?.kind === "build" ? rest : chains)];
}

export const BASE_GAME = "Base game";
export const UNNAMED_TYPES = "Unnamed types";

/**
 * The heading the list shows `entry` under: its mod's name, `Base game`, or `Unnamed types` for
 * one the game names nothing of, which the list shows last.
 */
export function entryHeading(entry: MegastructureEntry): string {
  return entry.unnamed ? UNNAMED_TYPES : (entry.section ?? BASE_GAME);
}

const FINISHED = "Finished";

/** Whether `stage` is told by its place in a build chain of more than one stage. */
const numbered = (stage: MegastructureStage, chain: MegastructureChain) =>
  chain.kind === "build" && stage.count > 1;

/** `Stage 3 of 4: Maturity`; null for a chain of one, a ruins row or a variant's row. */
export function stageLine(stage: MegastructureStage, chain: MegastructureChain): string | null {
  return numbered(stage, chain) ? `Stage ${stage.index} of ${stage.count}: ${stage.short}` : null;
}

/**
 * The Add button's text: `Add Maturity, stage 3 of 4`, with the stage's full name for a finished
 * one; `Add <name>` for a chain of one, a ruins row or a variant's row.
 */
export function addLabel(stage: MegastructureStage, chain: MegastructureChain): string {
  if (!numbered(stage, chain)) return `Add ${stage.label}`;
  const name = stage.short.startsWith(FINISHED) ? stage.label : stage.short;
  return `Add ${name}, stage ${stage.index} of ${stage.count}`;
}

/** Every stage of `entry`, row by row. */
export function entryStages(entry: MegastructureEntry): MegastructureStage[] {
  return entry.chains.flatMap((chain) => chain.stages);
}

/** Where stage `key` stands in `entries`: its megastructure, row and tile; null when none has it. */
export function findStage(
  entries: readonly MegastructureEntry[],
  key: string | null,
): { entry: MegastructureEntry; chain: MegastructureChain; stage: MegastructureStage } | null {
  for (const entry of entries) {
    for (const chain of entry.chains) {
      const stage = chain.stages.find((s) => s.key === key);
      if (stage) return { entry, chain, stage };
    }
  }
  return null;
}

/** The stage a megastructure opens on: its first row's finished stage. */
export function entryDefault(entry: MegastructureEntry): string {
  return entry.chains[0].finished;
}

/**
 * The megastructures whose name, or the name or key of one of whose stages, holds `query`,
 * ignoring case; every named one for a blank query. An unnamed one shows only when the key of
 * one of its stages holds the query.
 */
export function matchingEntries(
  entries: readonly MegastructureEntry[],
  query: string,
): MegastructureEntry[] {
  const needle = query.trim().toLowerCase();
  const holds = (text: string) => text.toLowerCase().includes(needle);
  return entries.filter((entry) => {
    if (entry.unnamed) return needle !== "" && entryStages(entry).some((s) => holds(s.key));
    return (
      needle === "" ||
      holds(entry.label) ||
      entryStages(entry).some((stage) => holds(stage.label) || holds(stage.key))
    );
  });
}

/** The base game type each kind of spot opens on when nothing was added before. */
const USUAL = { star: "dyson_sphere_5", planet: "think_tank_3", space: "hyper_relay" } as const;

/**
 * The stage the dialog opens on, passing over any the save would refuse here: `last`, the type
 * added last, when it goes here; else a Dyson Sphere on a star, a Science Nexus on a planet or a
 * Hyper Relay in space, when the base game's section has it; else the first finished stage, base
 * game first; else the first stage at all. When every stage is refused, the first megastructure's
 * finished one.
 */
export function defaultStage(
  entries: readonly MegastructureEntry[],
  spot: MegastructureSpot,
  last: string | null,
): string | null {
  const usable = (list: readonly MegastructureEntry[], key: string | null) =>
    findStage(list, key)?.stage.refused === null;
  if (usable(entries, last)) return last;
  const listed = entries.filter((entry) => !entry.unnamed);
  const base = listed.filter((entry) => entry.section === null);
  const usual = spot.kind === "space" ? USUAL.space : spot.star ? USUAL.star : USUAL.planet;
  if (usable(base, usual)) return usual;
  const finished = [...base, ...listed].map(entryDefault).find((key) => usable(entries, key));
  if (finished !== undefined) return finished;
  const any = listed.flatMap(entryStages).find((stage) => stage.refused === null);
  if (any !== undefined) return any.key;
  return entries.length === 0 ? null : entryDefault(entries[0]);
}

/**
 * The stage the dialog has selected among the megastructures `visible` through the filter: the
 * one `picked`, else the one it opens on, when visible; else the first visible megastructure's
 * opening stage. Null when the filter hides every megastructure, so Add and Enter act only on a
 * stage the player can see.
 */
export function selectedStage(
  entries: readonly MegastructureEntry[],
  visible: readonly MegastructureEntry[],
  picked: string | null,
  spot: MegastructureSpot,
  last: string | null,
): { entry: MegastructureEntry; chain: MegastructureChain; stage: MegastructureStage } | null {
  return (
    findStage(visible, picked ?? defaultStage(entries, spot, last)) ??
    findStage(visible, defaultStage(visible, spot, null))
  );
}

const BYPASS_NAMES: Readonly<Record<string, string>> = {
  gateway: "gateway",
  relay_bypass: "hyper relay",
};

/**
 * Why the save would refuse a row of `type` at `spot` of a system whose rows are `rows`: a second
 * gateway or relay in the system, or a body that has a megastructure already. A habitat is no
 * row, and is refused only round a body that orbits a planet. A whole ring world is refused as
 * `ringWorldRefusal` says of the system's `planets`. Null when it fits.
 */
export function megastructureRefusal(
  type: MegastructureView,
  spot: MegastructureSpot,
  rows: readonly MegastructureSummary[],
  types: ReadonlyMap<string, MegastructureView>,
  planets: readonly PlanetSummary[] = [],
): string | null {
  if (isRingWorld(type)) return ringWorldRefusal(planets, rows);
  if (type.habitat && spot.kind === "body") {
    return spot.orbitsPlanet === true ? HABITAT_ROUND_SATELLITE : null;
  }
  const bypass = type.bypass_type;
  if (bypass !== null && bypass in BYPASS_NAMES) {
    if (rows.some((row) => types.get(row.kind)?.bypass_type === bypass)) {
      return `The system already has a ${BYPASS_NAMES[bypass]}.`;
    }
  }
  if (hostHasMegastructure(spot, rows)) {
    return BODY_HAS_MEGASTRUCTURE;
  }
  return null;
}

/** What the dialog says of the owner a new megastructure gets. */
export const OWNER_NOTE = "It goes to the empire that owns the system.";
export const NO_OWNER = "No owner";
export const NO_OWNER_NOTE = "A megastructure goes to the empire that owns its system.";

/** What the dialog says of a type it has no model for. */
export const NO_MODEL = "No model yet";
export const NO_MODEL_NOTE = "Galaxy Forge can't draw this type's model yet.";

/**
 * The notice after an add that left out effects of its construction: `unsure` the editor could not
 * tell apply, `unwritten` that apply but that it does not write. Null when it left out none.
 */
export function leftOutNotice(name: string, unsure: number, unwritten: number): string | null {
  if (unsure === 0 && unwritten === 0) return null;
  const parts = [`Added the ${name}.`];
  if (unsure === 1) {
    parts.push(
      "Galaxy Forge couldn't tell whether 1 of its construction's effects applies, so it left it out.",
    );
  } else if (unsure > 1) {
    parts.push(
      `Galaxy Forge couldn't tell whether ${unsure} of its construction's effects apply, so it left them out.`,
    );
  }
  if (unwritten === 1) {
    parts.push(
      "Galaxy Forge doesn't write 1 of its construction's effects yet, so it left it out.",
    );
  } else if (unwritten > 1) {
    parts.push(
      `Galaxy Forge doesn't write ${unwritten} of its construction's effects yet, so it left them out.`,
    );
  }
  return parts.join(" ");
}

/** Whether a type stands just outside the system's inner radius, as relays and gateways do. */
export function outsideGravityWell(type: MegastructureView | undefined): boolean {
  return type?.placement.place === "free" && type.placement.outside_gravity_well;
}

/**
 * Where a row of `type` added at `spot` stands: on the body, at the point pressed, or for a
 * type built outside the gravity well, just outside `innerRadius` in the pressed direction.
 */
export function megastructurePlace(
  spot: MegastructureSpot,
  type: MegastructureView | undefined,
  innerRadius: number,
): MegastructurePlace {
  if (spot.kind === "body") return { place: "body", body: spot.body };
  if (!outsideGravityWell(type)) return { place: "free", x: spot.x, y: spot.y };
  const radius = RELAY_RADIUS_FACTOR * innerRadius;
  const angle = Math.atan2(spot.y, spot.x);
  return { place: "free", x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** The dialog's Where line: around the body, or where in the system the row stands. */
export function whereText(
  spot: MegastructureSpot,
  type: MegastructureView | undefined,
  bodyName: string | undefined,
): string {
  if (spot.kind === "body") return `Around ${bodyName ?? `#${spot.body}`}`;
  const at = placementAt(spot.x, spot.y);
  if (outsideGravityWell(type)) return `Just outside the inner radius, at ${at.angle}°`;
  return `At ${orbitText(at)}`;
}
