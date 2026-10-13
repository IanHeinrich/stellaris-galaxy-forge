/**
 * What the Add megastructure dialog offers at a spot of the system view: the megastructures the
 * game data defines, grouped as the player knows them, each with its stages. What goes at the
 * spot, the type each stage writes and why the save would refuse it come from the shell.
 */
import type { MegastructureFit } from "../generated/MegastructureFit";
import type { MegastructurePlace } from "../generated/MegastructurePlace";
import type { MegastructureSummary } from "../generated/MegastructureSummary";
import type { MegastructureView } from "../generated/MegastructureView";
import type { RingStage } from "../generated/RingStage";
import { megastructureLabel } from "./details/labels";
import {
  FINISHED,
  RING_STAGE,
  RING_WORLD_LABEL,
  RING_WORLD_SUMMARY,
  refusalSentence,
} from "./megastructureCopy";
import { swappedTypes, swapsByStarClass } from "./megastructureVariants";
import { offeredStages } from "./ringWorldAdd";

/** Whether `spot` is a body that a row of `rows` stands at. */
export function hostHasMegastructure(
  spot: MegastructureSpot,
  rows: readonly MegastructureSummary[],
): boolean {
  return spot.kind === "body" && rows.some((row) => row.planet === spot.body);
}
/** Why no habitat goes round a body. */

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
    }
  | { readonly kind: "space"; readonly x: number; readonly y: number };

/** Whether a type is a stage of a ring world past its site, which the dialog adds as the whole ring. */
export function isRingWorld(type: MegastructureView): boolean {
  return type.placement.place === "unsupported" && type.placement.why.kind === "ring_world";
}

/** One size of ring world the game data defines, told by the radius its ring stands at. */
export interface RingWorldSizeName {
  radius: number | null;
  /**
   * The game's name for it: its site's name without the words every size's site shares, such
   * as `Titanic Ringworld`. `Ring World` when the game data defines one size.
   */
  name: string;
  /** What the size choice calls it: its name without the ring world's own words, `Titanic`. */
  label: string;
}

/**
 * Each size of ring world among `types`, its ring world types grouped by the radius their ring
 * stands at, named from the site its chain starts from, else from its ring.
 */
export function ringWorldSizes(
  types: ReadonlyMap<string, MegastructureView>,
  names: ReadonlyMap<string, string>,
): RingWorldSizeName[] {
  const groups: { radius: number | null; keys: string[] }[] = [];
  for (const type of types.values()) {
    if (!isRingWorld(type)) continue;
    const group = groups.find((g) => g.radius === type.ring_world_radius);
    if (group) group.keys.push(type.key);
    else groups.push({ radius: type.ring_world_radius, keys: [type.key] });
  }
  if (groups.length < 2) {
    return groups.map(({ radius }) => ({
      radius,
      name: RING_WORLD_LABEL,
      label: RING_WORLD_LABEL,
    }));
  }
  const nameOf = (key: string) => cleanName(names.get(key) ?? "") || megastructureLabel(key);
  const sources = groups.map(({ keys }) => {
    const site = keys
      .flatMap((key) => {
        const type = types.get(key)!;
        return type.variant_of === null
          ? type.upgrade_from
          : [...type.upgrade_from, type.variant_of];
      })
      .find((key) => types.has(key) && !isRingWorld(types.get(key)!));
    return nameOf(site ?? keys[0])
      .split(/\s+/)
      .filter((word) => word !== "");
  });
  const wordOf = (word: string) => plainWords(word)[0] ?? "";
  const ringWords = new Set([
    ...plainWords(RING_WORLD_LABEL),
    plainWords(RING_WORLD_LABEL).join(""),
  ]);
  const shared = sources[0]
    .map(wordOf)
    .filter((word) => sources.every((words) => words.some((w) => wordOf(w) === word)));
  return groups.map(({ radius }, i) => {
    const own = sources[i].filter((word) => !shared.includes(wordOf(word)));
    const name = (own.length > 0 ? own : sources[i]).join(" ");
    const label = own.filter((word) => !ringWords.has(wordOf(word))).join(" ");
    return { radius, name, label: label === "" ? RING_WORLD_LABEL : label };
  });
}

const VARIANT_WORDS = new Set(["permanently", "ruined", "restored", "destroyed", "derelict"]);

/** Whether a type is a ruined, restored, destroyed or derelict variant of a working one. */
function isVariant(type: MegastructureView): boolean {
  return type.variant_of !== null;
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

/** One size of a ring world, as its size choice offers it. */
export interface RingWorldSize {
  /** The ring world type Add sends for the whole ring. */
  ring: string;
  /** What the size choice calls it: `Ring World`, `Titanic`. */
  label: string;
  /** Why the Ring tile is greyed out at this size; null when the ring fits. */
  refused: string | null;
  /** The stages a quadrant of its ring is offered at, in the grid's order. */
  stages: readonly RingStage[];
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
  /** The texture key of the game's picture of its main chain's finished stage, else of the last
   * stage before it that has one; null when none has. */
  portrait: string | null;
  /** The kind and categories the game's build tooltip gives the first stage of its main chain
   * that has them, such as `Kilostructure · Science Production`; null when none has. */
  category: string | null;
  /** A ring world's sizes, the base game's first, then by radius; empty for any other megastructure. */
  sizes: RingWorldSize[];
  /** The size of ring world its Site and Ring tiles add; null for any other megastructure. */
  size: RingWorldSize | null;
}

/** What the list shows of a megastructure beside its name, read from its main chain's types. */
function cardOf(
  main: MegastructureChain,
  types: ReadonlyMap<string, MegastructureView>,
): Pick<MegastructureEntry, "portrait" | "category"> {
  const stages = main.stages.map((stage) => types.get(stage.key));
  const built = stages.slice(0, main.stages.findIndex((s) => s.key === main.finished) + 1);
  return {
    portrait: built.reverse().find((type) => type?.portrait)?.portrait ?? null,
    category: stages.find((type) => type?.category)?.category ?? null,
  };
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

/** The fits the shell answered for a spot, by the type offered. */
export type MegastructureFits = ReadonlyMap<string, MegastructureFit>;

/** The fits of `answer`, by the type offered. */
export function fitsByKind(answer: readonly MegastructureFit[]): MegastructureFits {
  return new Map(answer.map((fit) => [fit.kind, fit]));
}

/** Where a row of `kind`, the type a stage writes, stands at the spot `fits` were read for. */
export function placeOf(fits: MegastructureFits, kind: string): MegastructurePlace | null {
  return [...fits.values()].find((fit) => fit.variant === kind)?.place ?? null;
}

/** Why the save would refuse `kind` at the spot, as a sentence; null when it goes. */
function refusalOf(fits: MegastructureFits, kind: string): string | null {
  const refusal = fits.get(kind)?.refusal ?? null;
  return refusal === null ? null : refusalSentence(refusal);
}

/**
 * The megastructures that go at the spot `fits` were read for. Each is a group of types joined
 * by the stages they are built over, the working type a ruin belongs to and the type a build
 * turns into, and the groups of one name in one section are one megastructure. Its main build
 * chain names it and comes first, then its other chains, then its ruined and restored versions.
 * The base game's come first, then each mod's under its name, each section by name, and a mod's
 * unnamed types last. A type `fits` does not offer is left out, and one it refuses is listed
 * greyed out with the reason. Every ring world chain is one Ring World megastructure, in the base
 * game's section when the base game defines a ring, with a size for each radius its chains' rings
 * stand at, the base game's first, then by radius. Its stages past its site are one Ring tile
 * after the site, which adds the ring whole; both add the size `ringSize` picks, else the first,
 * and keep the first size's keys. The Ring tile is greyed out with the reason `fits` gives for
 * the size's ring world type. A row of a megastructure whose types are all made from script and
 * have no localised name, such as the Gateway family's `blokkat_dummy_mega`, is left out.
 *
 * A type the game data does not offer is left out. A type the game makes only by swapping a
 * finished row, such as a star class's Dyson Sphere, is not listed: the stage it is swapped from
 * is, and its `variant` is the type `fits` says the game makes of it there. The ruins of a
 * star class's chain go with it.
 */
export function megastructureEntries(
  types: ReadonlyMap<string, MegastructureView>,
  names: ReadonlyMap<string, string>,
  fits: MegastructureFits,
  ringSize: string | null = null,
): MegastructureEntry[] {
  const named = (key: string) => cleanName(names.get(key) ?? "") !== "";
  const nameOf = (key: string) =>
    named(key) ? cleanName(names.get(key)!) : megastructureLabel(key);
  const swapped = swappedTypes(types);
  const classStems = new Set([...swappedTypes(types, true)].map(stem));
  const listed = (type: MegastructureView) =>
    fits.has(type.key) &&
    !swapped.has(type.key) &&
    !(isVariant(type) && classStems.has(bareStem(type.key)));
  const fitting = new Map([...types].filter(([, type]) => listed(type)));
  const known = new Map<string, number>();
  const order = new Map([...types.keys()].map((key, i) => [key, i]));
  const byStage = (a: MegastructureView, b: MegastructureView) =>
    stageOf(a.key, types, known) - stageOf(b.key, types, known) ||
    order.get(a.key)! - order.get(b.key)!;
  const families = new Map<
    string,
    { label: string; section: string | null; unnamed: boolean; byClass: boolean; rows: Row[] }
  >();
  const rings: RingGroup[] = [];
  for (const group of linked(fitting)) {
    const built = groupRows(group, byStage, order);
    const shown = shownRows(built, types);
    if (shown === null) continue;
    const byClass = swapsByStarClass(built[0].keys, types);
    const ring = shown.flatMap((row) => row.keys).find((k) => isRingWorld(types.get(k)!)) ?? null;
    if (ring !== null) {
      const rows = shown
        .map((row) => ({ ...row, keys: row.keys.filter((k) => !isRingWorld(types.get(k)!)) }))
        .filter((row) => row.keys.length > 0);
      foldRing(rings, ring, rows, types);
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
      families.set(key, { label, section, unnamed, byClass, rows });
      continue;
    }
    family.byClass ||= byClass;
    const [first, ...rest] = rows;
    family.rows.push({ ...first, kind: "variant" }, ...rest);
    family.rows.sort((a, b) => Number(a.kind === "ruins") - Number(b.kind === "ruins"));
  }
  const chainsOf = (rows: Row[], label: string): MegastructureChain[] => {
    labelRows(rows, label, nameOf, named);
    const titles = stageTitles(rows, nameOf);
    return rows.map((row): MegastructureChain => {
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
          refused: refusalOf(fits, k),
          variant: fits.get(k)?.variant ?? k,
        })),
        working,
        finished: row.keys[Math.max(working, 1) - 1],
      };
    });
  };
  const entries: MegastructureEntry[] = [];
  for (const [key, family] of families) {
    const { label, section, unnamed, byClass, rows } = family;
    const chains = chainsOf(rows, label);
    const summary = summaryOf(rows, byClass);
    const card = cardOf(chains[0], types);
    entries.push({ key, label, section, unnamed, summary, chains, ...card, sizes: [], size: null });
  }
  if (rings.length > 0) {
    const sizeNames = ringWorldSizes(types, names);
    rings.sort(
      (a, b) =>
        Number(a.section !== null) - Number(b.section !== null) ||
        (a.radius ?? 0) - (b.radius ?? 0),
    );
    const sized = rings.map((group) => {
      const type = types.get(group.ring)!;
      const sizeName = sizeNames.find((s) => s.radius === group.radius);
      const name = rings.length > 1 ? (sizeName?.name ?? RING_WORLD_LABEL) : RING_WORLD_LABEL;
      const chains = chainsOf(group.rows, name);
      const build = chains[0]?.kind === "build";
      const size: RingWorldSize = {
        ring: group.ring,
        label: sizeName?.label ?? RING_WORLD_LABEL,
        refused: refusalOf(fits, group.ring),
        stages: offeredStages(type.ring_world_refused_stages),
      };
      return {
        size,
        name,
        site: build ? chains[0].stages : [],
        rest: build ? chains.slice(1) : chains,
      };
    });
    const [base] = sized;
    const chosen = sized.find((s) => s.size.ring === ringSize) ?? base;
    const site = chosen.site.map((stage, i) => ({ ...stage, key: base.site[i]?.key ?? stage.key }));
    const chains = ringChains(site, chosen.rest, {
      key: base.size.ring,
      variant: chosen.size.ring,
      label: chosen.name,
      refused: chosen.size.refused,
    });
    const section = rings[0].section;
    entries.push({
      key: `${section ?? ""}/${RING_WORLD_LABEL}`,
      label: RING_WORLD_LABEL,
      section,
      unnamed: false,
      summary: RING_WORLD_SUMMARY,
      chains,
      ...cardOf(chains[0], types),
      sizes: sized.map((s) => s.size),
      size: chosen.size,
    });
  }
  return entries.sort(
    (a, b) =>
      Number(a.unnamed) - Number(b.unnamed) ||
      Number(a.section !== null) - Number(b.section !== null) ||
      (a.section ?? "").localeCompare(b.section ?? "") ||
      a.label.localeCompare(b.label),
  );
}

/** The ring world types of one size: those whose ring stands at `radius`, from any mod. */
interface RingGroup {
  radius: number | null;
  /** The type Add sends: one the game data lays a ring out for, when one does. */
  ring: string;
  /** Its rows without its ring world types: its site's chain. */
  rows: Row[];
  /** The mod of its ring world type; null when the base game defines one. */
  section: string | null;
}

/**
 * Folds `ring`'s group, whose rows less its ring world types are `rows`, into the size of `rings`
 * whose ring stands where its does, else adds a size.
 */
function foldRing(
  rings: RingGroup[],
  ring: string,
  rows: Row[],
  types: ReadonlyMap<string, MegastructureView>,
): void {
  const type = types.get(ring)!;
  const section = type.base_game ? null : type.source;
  const same = rings.find((group) => group.radius === type.ring_world_radius);
  if (same === undefined) {
    rings.push({ radius: type.ring_world_radius, ring, rows, section });
    return;
  }
  same.rows.push(...rows);
  same.rows.sort((a, b) => Number(a.kind !== "build") - Number(b.kind !== "build"));
  const laidOut = (key: string) => types.get(key)!.ring_world_refused === null;
  if (!laidOut(same.ring) && laidOut(ring)) same.ring = ring;
  if (section === null) same.section = null;
}

/**
 * A ring world's rows: its site's tiles and the Ring tile `ring`, which adds the ring whole, in
 * one row, then `rest`; the dialog opens the megastructure on the Ring tile.
 */
function ringChains(
  site: readonly MegastructureStage[],
  rest: readonly MegastructureChain[],
  ring: Pick<MegastructureStage, "key" | "variant" | "label" | "refused">,
): MegastructureChain[] {
  const count = site.length + 1;
  const stage: MegastructureStage = {
    ...ring,
    short: RING_STAGE,
    index: count,
    count,
    ring: true,
  };
  const row: MegastructureChain = {
    label: null,
    kind: "ring",
    first: site[0]?.key ?? ring.key,
    stages: [...site.map((s) => ({ ...s, count })), stage],
    working: count,
    finished: ring.key,
  };
  return [row, ...rest];
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
