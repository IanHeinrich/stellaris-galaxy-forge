/**
 * What the Add megastructure dialog offers at a spot of the system view: the megastructures the
 * editor adds there, each with its stages, and where the new row stands.
 */
import { RELAY_RADIUS_FACTOR } from "../generated/constants";
import type { MegastructurePlace } from "../generated/MegastructurePlace";
import type { MegastructureSummary } from "../generated/MegastructureSummary";
import type { MegastructureTypeView } from "../generated/MegastructureTypeView";
import { megastructureLabel } from "./details/labels";
import { orbitText, placementAt } from "./planetMove";

export { RELAY_RADIUS_FACTOR };

export const ADD_MEGASTRUCTURE_HERE_LABEL = "Add megastructure here…";
export const ADD_MEGASTRUCTURE_LABEL = "Add megastructure…";
export const MEGASTRUCTURES_NEED_GAME_DATA = "Load game data to add a megastructure.";
export const BODY_HAS_MEGASTRUCTURE = "It already has a megastructure.";
export const NO_MEGASTRUCTURE_FITS = "No megastructure the game data defines can go here.";

/** What the dialog says before Add. */
export const WRITTEN_FINISHED = "The megastructure is added finished.";

/** Where in the system view the Add megastructure menu was opened: on a body, or in empty space. */
export type MegastructureSpot =
  | { readonly kind: "body"; readonly body: number; readonly star: boolean }
  | { readonly kind: "space"; readonly x: number; readonly y: number };

/** Whether a type of `placement` goes at `spot`: a free point in empty space, a body on a body. */
function fits(type: MegastructureTypeView, spot: MegastructureSpot): boolean {
  const { placement } = type;
  if (spot.kind === "space") return placement.place === "free";
  return placement.place === "body" && (!placement.star_only || spot.star);
}

const VARIANT = /_(permanently_ruined|ruined|restored|destroyed|derelict)(_|$)/;

/** Whether a type is a ruined, restored, destroyed or derelict variant of a working one. */
function isVariant(type: MegastructureTypeView): boolean {
  return type.variant_of !== null || VARIANT.test(type.key);
}

/** One stage the dialog offers, as a tile. */
export interface MegastructureStage {
  key: string;
  /** Its localised name, else the words of its key. */
  label: string;
  /** Why the save would refuse it here, such as a second relay in the system; null when it fits. */
  refused: string | null;
}

/** One upgrade chain of a megastructure, as a row of tiles. */
export interface MegastructureChain {
  /** What tells the row apart from the megastructure's other rows; null for a megastructure of one. */
  label: string | null;
  /** The key of its first stage. */
  first: string;
  /** Its working stages in chain order, then its ruined and restored variants. */
  stages: MegastructureStage[];
  /** How many of `stages` are working stages. */
  working: number;
  /** The key of its finished stage: its last working one. */
  finished: string;
}

/** One megastructure as the player knows it, as the dialog's list shows it. */
export interface MegastructureEntry {
  /** Its section and name, unique in the list. */
  key: string;
  /** The localised name of its finished stage. */
  label: string;
  /** The mod it comes from; null for the base game's. */
  section: string | null;
  chains: MegastructureChain[];
}

/** How many stages come before `key` in its chain, by the longest way back through `upgrade_from`. */
function stageOf(
  key: string,
  types: ReadonlyMap<string, MegastructureTypeView>,
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

/** The groups `upgrade_from` and the variant links join `types` into, each in file order. */
function linked(types: ReadonlyMap<string, MegastructureTypeView>): MegastructureTypeView[][] {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    let at = key;
    while (parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  const join = (a: string, b: string) => {
    if (!types.has(a) || !types.has(b)) return;
    const [x, y] = [root(a), root(b)];
    if (x !== y) parent.set(x, y);
  };
  for (const key of types.keys()) parent.set(key, key);
  for (const type of types.values()) {
    for (const from of type.upgrade_from) join(type.key, from);
    if (type.variant_of !== null) join(type.key, type.variant_of);
  }
  const groups = new Map<string, MegastructureTypeView[]>();
  for (const type of types.values()) {
    const group = groups.get(root(type.key));
    if (group) group.push(type);
    else groups.set(root(type.key), [type]);
  }
  return [...groups.values()];
}

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

/**
 * What tells `chains` apart, in order: the names of their first stages when those differ from
 * each other and from the megastructure's, else the part of their finished keys after the words
 * they all share, stage numbers left out.
 */
function rowLabels(
  chains: readonly MegastructureChain[],
  label: string,
  nameOf: (key: string) => string,
): string[] {
  const firsts = chains.map((chain) => nameOf(chain.first));
  if (new Set(firsts).size === firsts.length && !firsts.includes(label)) return firsts;
  const words = chains.map((chain) => chain.finished.split("_").filter((w) => !/^\d+$/.test(w)));
  let shared = 0;
  while (words.every((w) => w.length > shared && w[shared] === words[0][shared])) shared++;
  return words.map((w) => keyWords(w.slice(shared)));
}

/**
 * The megastructures that go at `spot`: each upgrade chain of `types` with its ruined and restored
 * variants, the chains of one name in one section merged into one megastructure. The base game's
 * come first, then each mod's under its name, each section by name. A type whose placement can
 * never go at `spot`, or that the editor does not add, is left out; `refusalOf` says why the save
 * would refuse one that does fit.
 */
export function megastructureEntries(
  types: ReadonlyMap<string, MegastructureTypeView>,
  names: ReadonlyMap<string, string>,
  spot: MegastructureSpot,
  refusalOf: (type: MegastructureTypeView) => string | null = () => null,
): MegastructureEntry[] {
  const nameOf = (key: string) => names.get(key) ?? megastructureLabel(key);
  const fitting = new Map([...types].filter(([, type]) => fits(type, spot)));
  const known = new Map<string, number>();
  const order = new Map([...types.keys()].map((key, i) => [key, i]));
  const byStage = (a: MegastructureTypeView, b: MegastructureTypeView) =>
    stageOf(a.key, types, known) - stageOf(b.key, types, known) ||
    order.get(a.key)! - order.get(b.key)!;
  const entries = new Map<string, MegastructureEntry>();
  for (const group of linked(fitting)) {
    const working = group.filter((type) => !isVariant(type)).sort(byStage);
    const variants = group.filter(isVariant).sort(byStage);
    const ordered = [...working, ...variants];
    const finished = working[working.length - 1] ?? ordered[ordered.length - 1];
    const label = nameOf(finished.key);
    const section = finished.base_game ? null : finished.source;
    const key = `${section ?? ""}/${label}`;
    const chain: MegastructureChain = {
      label: null,
      first: ordered[0].key,
      stages: ordered.map((type) => ({
        key: type.key,
        label: nameOf(type.key),
        refused: refusalOf(type),
      })),
      working: working.length,
      finished: finished.key,
    };
    const entry = entries.get(key);
    if (entry) entry.chains.push(chain);
    else entries.set(key, { key, label, section, chains: [chain] });
  }
  for (const entry of entries.values()) {
    if (entry.chains.length < 2) continue;
    const labels = rowLabels(entry.chains, entry.label, nameOf);
    entry.chains.forEach((chain, i) => (chain.label = labels[i]));
    entry.chains.sort((a, b) => a.label!.localeCompare(b.label!) || a.first.localeCompare(b.first));
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(a.section !== null) - Number(b.section !== null) ||
      (a.section ?? "").localeCompare(b.section ?? "") ||
      a.label.localeCompare(b.label),
  );
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
 * ignoring case; every one for a blank query.
 */
export function matchingEntries(
  entries: readonly MegastructureEntry[],
  query: string,
): MegastructureEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...entries];
  const holds = (text: string) => text.toLowerCase().includes(needle);
  return entries.filter(
    (entry) =>
      holds(entry.label) ||
      entryStages(entry).some((stage) => holds(stage.label) || holds(stage.key)),
  );
}

/** The base game type each kind of spot opens on when nothing was added before. */
const USUAL = { star: "dyson_sphere_5", planet: "think_tank_3", space: "hyper_relay" } as const;

/**
 * The stage the dialog opens on: `last`, the type added last, when it goes here; else a Dyson
 * Sphere on a star, a Science Nexus on a planet or a Hyper Relay in space, when the base game's
 * section has it; else the first base game megastructure's finished stage, else the first one's.
 */
export function defaultStage(
  entries: readonly MegastructureEntry[],
  spot: MegastructureSpot,
  last: string | null,
): string | null {
  if (last !== null && findStage(entries, last) !== null) return last;
  const base = entries.filter((entry) => entry.section === null);
  const usual = spot.kind === "space" ? USUAL.space : spot.star ? USUAL.star : USUAL.planet;
  if (findStage(base, usual) !== null) return usual;
  const first = base[0] ?? entries[0];
  return first === undefined ? null : entryDefault(first);
}

const BYPASS_NAMES: Readonly<Record<string, string>> = {
  gateway: "gateway",
  relay_bypass: "hyper relay",
};

/**
 * Why the save would refuse a row of `type` at `spot` of a system whose rows are `rows`: a second
 * gateway or relay in the system, or a body that has a megastructure already. Null when it fits.
 */
export function megastructureRefusal(
  type: MegastructureTypeView,
  spot: MegastructureSpot,
  rows: readonly MegastructureSummary[],
  types: ReadonlyMap<string, MegastructureTypeView>,
): string | null {
  const bypass = type.bypass_type;
  if (bypass !== null && bypass in BYPASS_NAMES) {
    if (rows.some((row) => types.get(row.kind)?.bypass_type === bypass)) {
      return `The system already has a ${BYPASS_NAMES[bypass]}.`;
    }
  }
  if (spot.kind === "body" && rows.some((row) => row.planet === spot.body)) {
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

/** The notice after an add that left out effects of its construction the editor could not judge. */
export function leftOutNotice(name: string, count: number): string {
  const which =
    count === 1
      ? "1 of its construction's effects applies, so it left it out"
      : `${count} of its construction's effects apply, so it left them out`;
  return `Added the ${name}. Galaxy Forge couldn't tell whether ${which}.`;
}

/** Whether a type stands just outside the system's inner radius, as relays and gateways do. */
export function outsideGravityWell(type: MegastructureTypeView | undefined): boolean {
  return type?.placement.place === "free" && type.placement.outside_gravity_well;
}

/**
 * Where a row of `type` added at `spot` stands: on the body, at the point pressed, or for a
 * type built outside the gravity well, just outside `innerRadius` in the pressed direction.
 */
export function megastructurePlace(
  spot: MegastructureSpot,
  type: MegastructureTypeView | undefined,
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
  type: MegastructureTypeView | undefined,
  bodyName: string | undefined,
): string {
  if (spot.kind === "body") return `Around ${bodyName ?? `#${spot.body}`}`;
  const at = placementAt(spot.x, spot.y);
  if (outsideGravityWell(type)) return `Just outside the inner radius, at ${at.angle}°`;
  return `At ${orbitText(at)}`;
}
