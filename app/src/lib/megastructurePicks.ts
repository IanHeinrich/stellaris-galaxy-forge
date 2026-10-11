/**
 * What the Add megastructure dialog offers at a spot of the system view: the types the editor
 * adds there, grouped by upgrade family, where the new row stands, and who owns it at first.
 */
import { RELAY_RADIUS_FACTOR } from "../generated/constants";
import type { MegastructurePlace } from "../generated/MegastructurePlace";
import type { MegastructureTypeView } from "../generated/MegastructureTypeView";
import { megastructureLabel, megastructureParts } from "./details/labels";
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

/** One type the dialog offers. */
export interface MegastructurePick {
  key: string;
  /** Its localised name, else the words of its key. */
  label: string;
  /** The localised name of the first stage of its upgrade family. */
  family: string;
  /** The key of the first stage of its upgrade family. */
  familyKey: string;
  /** What its key says of it, such as `stage 3` or `ruined`; null for a finished one. */
  state: string | null;
}

/** Whether a type of `placement` goes at `spot`: a free point in empty space, a body on a body. */
function fits(type: MegastructureTypeView, spot: MegastructureSpot): boolean {
  const { placement } = type;
  if (spot.kind === "space") return placement.place === "free";
  return placement.place === "body" && (!placement.star_only || spot.star);
}

/** The families `upgrade_from` joins `types` into: each key's family, named by its first key. */
function families(types: ReadonlyMap<string, MegastructureTypeView>): Map<string, string> {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    let at = key;
    while (parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  for (const key of types.keys()) parent.set(key, key);
  for (const type of types.values()) {
    for (const from of type.upgrade_from) {
      if (!types.has(from)) continue;
      const [a, b] = [root(type.key), root(from)];
      if (a !== b) parent.set(a, b);
    }
  }
  const starts = (type: MegastructureTypeView) =>
    !type.upgrade_from.some((from) => types.has(from));
  // The first type of each family that is built over none; a family in a loop takes its first.
  const firstStage = new Map<string, string>();
  for (const type of [...types.values()].filter(starts)) {
    if (!firstStage.has(root(type.key))) firstStage.set(root(type.key), type.key);
  }
  return new Map([...types.keys()].map((key) => [key, firstStage.get(root(key)) ?? root(key)]));
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

/**
 * The types that go at `spot`, family by family in the order of their names, each family in
 * chain order. A type the editor does not add is left out.
 */
export function megastructurePicks(
  types: ReadonlyMap<string, MegastructureTypeView>,
  names: ReadonlyMap<string, string>,
  spot: MegastructureSpot,
): MegastructurePick[] {
  const nameOf = (key: string) => names.get(key) ?? megastructureLabel(key);
  const familyOf = families(types);
  const stages = new Map<string, number>();
  const order = new Map([...types.keys()].map((key, i) => [key, i]));
  const picks = [...types.values()]
    .filter((type) => fits(type, spot))
    .map((type) => {
      const { state } = megastructureParts(type.key);
      const first = familyOf.get(type.key)!;
      return {
        key: type.key,
        label: nameOf(type.key),
        family: nameOf(first),
        familyKey: first,
        state: state === "complete" ? null : state,
        // Two families of one name, as a ruin's beside its working chain, each stay whole.
        first: order.get(first)!,
        stage: stageOf(type.key, types, stages),
        at: order.get(type.key)!,
      };
    });
  picks.sort(
    (a, b) =>
      a.family.localeCompare(b.family) || a.first - b.first || a.stage - b.stage || a.at - b.at,
  );
  return picks.map(({ key, label, family, familyKey, state }) => ({
    key,
    label,
    family,
    familyKey,
    state,
  }));
}

/** One upgrade family as the dialog's dropdown lists it, and its stages as tiles. */
export interface MegastructureFamily {
  /** The key of its first stage. */
  key: string;
  label: string;
  /** The mod its first stage comes from; none for the base game's. */
  section?: string;
  /** How many stages it offers here, when more than one. */
  note?: string;
  picks: MegastructurePick[];
}

/**
 * `picks` gathered into their families, in the order `megastructurePicks` gives: the base
 * game's first, then each mod's under its name, mods in the order of their names. `sourceOf`
 * names the mod a type comes from, null for the base game.
 */
export function megastructureFamilies(
  picks: readonly MegastructurePick[],
  sourceOf: (key: string) => string | null,
): MegastructureFamily[] {
  const families: MegastructureFamily[] = [];
  for (const pick of picks) {
    const last = families[families.length - 1];
    if (last?.key === pick.familyKey) last.picks.push(pick);
    else {
      const section = sourceOf(pick.familyKey) ?? undefined;
      families.push({ key: pick.familyKey, label: pick.family, section, picks: [pick] });
    }
  }
  for (const family of families) {
    if (family.picks.length > 1) family.note = `${family.picks.length} stages`;
  }
  const modded = (family: MegastructureFamily) => (family.section === undefined ? 0 : 1);
  return families.sort(
    (a, b) => modded(a) - modded(b) || (a.section ?? "").localeCompare(b.section ?? ""),
  );
}

/**
 * The stage a family opens on: its last, the finished structure, as the game's build menu
 * offers the whole chain under it.
 */
export function familyPick(family: MegastructureFamily): MegastructurePick {
  return family.picks[family.picks.length - 1];
}

/**
 * The types of every family whose name, family name or key holds `query`, ignoring case, in
 * the families' order; every type for a blank query.
 */
export function matchingPicks(
  families: readonly MegastructureFamily[],
  query: string,
): MegastructurePick[] {
  const needle = query.trim().toLowerCase();
  const all = families.flatMap((family) => family.picks);
  if (needle === "") return all;
  return all.filter((pick) =>
    [pick.label, pick.family, pick.key].some((text) => text.toLowerCase().includes(needle)),
  );
}

const RUIN = /_(ruined|permanently_ruined|destroyed|derelict)$/;

/** Who a new row of type `kind` belongs to at first: no one for a ruin, else the system's owner. */
export function defaultOwner(kind: string, systemOwner: number | null): number | null {
  return RUIN.test(kind) ? null : systemOwner;
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
