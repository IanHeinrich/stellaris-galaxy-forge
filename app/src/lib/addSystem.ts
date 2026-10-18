import type { DlcNeed } from "../generated/DlcNeed";
import type { Feature } from "../generated/Feature";
import type { LeftOut } from "../generated/LeftOut";
import type { PickSummary } from "../generated/PickSummary";
import type { SaveMeta } from "../generated/SaveMeta";
import type { SystemNode } from "../generated/SystemNode";
import { ADDED_SYSTEMS_FROM_MAJOR, GALAXY_REACH, SPAWN_BUFFER } from "../generated/constants";
import { capitalised, counted, listed, needsGameData } from "./text";
import type { Span } from "../generated/Span";
import { versionNumber } from "./version";

export { SPAWN_BUFFER };

export const NEEDS_GAME_DATA = needsGameData("add a system");
export const NEEDS_STELLARIS_4 = "Adding systems needs a Stellaris 4 save";
export const ADDED_THIS_SESSION = "Added this session";
/** What the placing rules read about the open save and the spot. */
export interface PlaceFacts {
  meta: SaveMeta | null;
  gameData: boolean;
  /** The save's galaxy radius; 0 when it records none. */
  radius: number;
  x: number;
  y: number;
  /** The system nearest the spot, when the galaxy has any. */
  nearest: { name: string; distance: number } | null;
}

/**
 * Why a system cannot be added, and which of the spot's limits the map should draw: another
 * system inside the spawn buffer around it, or the circle `reach` from the centre that a system
 * may stand within, which it is past.
 */
export type AddRefusal =
  | { reason: string; limit: null }
  | { reason: string; limit: "tooClose" }
  | { reason: string; limit: "outside"; reach: number };

/** Whether the save's version is Stellaris 4 or later, the only saves the core adds a system to. */
export function isStellaris4(meta: SaveMeta | null): boolean {
  const major = Number(versionNumber(meta?.version ?? "")?.split(".")[0]);
  return Number.isFinite(major) && major >= ADDED_SYSTEMS_FROM_MAJOR;
}

/** Why the core would refuse a system at the spot, checked as it checks, or null when it would take one. */
export function addSystemRefusal(facts: PlaceFacts): AddRefusal | null {
  if (!facts.gameData) return { reason: NEEDS_GAME_DATA, limit: null };
  if (!isStellaris4(facts.meta)) return { reason: NEEDS_STELLARIS_4, limit: null };
  const reach = facts.radius * GALAXY_REACH;
  if (reach > 0 && Math.hypot(facts.x, facts.y) > reach) {
    const reason = `Too far outside the galaxy: systems can be placed up to ${Math.floor(reach)} from the centre`;
    return { reason, limit: "outside", reach };
  }
  const near = facts.nearest;
  if (near && near.distance < SPAWN_BUFFER) {
    const away = Math.max(1, Math.round(near.distance));
    const reason = `Too close to ${near.name}: ${away} away, the game needs ${SPAWN_BUFFER}`;
    return { reason, limit: "tooClose" };
  }
  return null;
}

/** The systems among `ids` added this session, in the order given. */
export function addedAmong(
  systems: ReadonlyMap<number, SystemNode>,
  ids: readonly number[],
): number[] {
  return ids.filter((id) => systems.get(id)?.added === true);
}

/**
 * The menu entry that deletes the `added` systems of a selection and skips the `skipped` the
 * file already held, or null when none was added.
 */
export function deleteAddedLabel(added: number, skipped: number): string | null {
  if (added === 0) return null;
  const label = `Delete ${counted(added, "added system")}`;
  return skipped === 0 ? label : `${label} (skips ${skipped} already in the save)`;
}

/** One labelled line of a pick's hover card. */
export interface CardLine {
  label: string;
  text: string;
}

/** What a pick's hover card says: what it can produce, then how this galaxy and save stand with it. */
export interface PickCardCopy {
  lines: CardLine[];
  /** A unique layout's closing line, in the warning colour once the galaxy has one; null for others. */
  unique: { text: string; warn: boolean } | null;
  /** The warning that the save's own copy keeps the layout's event chain; null when it has no copy. */
  storyKept: string | null;
  /** The line saying the save lacks the layout's DLC; null when it has it or needs none. */
  missingDlc: string | null;
  /** The line saying the layout's event chain uses the rest of its cluster; null for a layout no cluster holds. */
  clusterSystems: string | null;
}

/**
 * What a system added from a layout comes without, in the words a player would use. The rest of
 * its cluster has a sentence of its own, `CLUSTER_SYSTEMS`.
 */
const LEFT_OUT_WORDS: Record<Exclude<LeftOut, "cluster_systems">, string> = {
  pre_ftl_civilisation: "a pre-FTL civilisation",
  colony: "colonies and pops",
  empire: "its empire",
  fleets: "fleets and guardians",
  starbase: "a starbase",
  anomaly: "an anomaly",
  dig_site: "a dig site",
  spawned_planets: "some of its planets",
  ambient_objects: "debris, wrecks and storms",
};

export const CLUSTER_SYSTEMS = "Its event chain also uses the other systems of its cluster.";

/** "3–11" for a span, "3" when its ends meet. */
export function spanText({ min, max }: Span): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

function featureText(features: Feature[]): string {
  return features.map((f) => (f.every ? f.name : `${f.name} (sometimes)`)).join(", ");
}

function starText(names: string[]): string {
  if (names.length > 3) return `One of ${names.length} classes`;
  return listed(names, "or");
}

/** A cluster a card is about, by what a sentence calls it: `the Junk Ratlings`. */
export interface ClusterName {
  phrase: string;
}

/**
 * How the open document takes a layout: built here, with what its script plants when `extras`, or
 * as a statement whose script the game runs, which plants it all and checks no DLC here.
 */
export type LayoutAdd = { kind: "built"; extras: boolean } | { kind: "script" };

const BUILT_WITH_EXTRAS: LayoutAdd = { kind: "built", extras: true };

/**
 * The card of the pick called `name`, or of a cluster, leaving out the lines it has nothing for.
 * Built without extras, what the layout plants is listed under Comes without; left to the game's
 * script, neither list applies.
 */
export function pickCard(
  summary: PickSummary,
  name: string | ClusterName,
  how: LayoutAdd = BUILT_WITH_EXTRAS,
): PickCardCopy {
  const lines: CardLine[] = [];
  const add = (label: string, text: string) => {
    if (text !== "") lines.push({ label, text });
  };
  const stars = summary.star_classes.map((c) => c.name);
  if (typeof name === "string") add("Star", starText(stars));
  else add("Stars", listed(stars, "and"));
  add("Planets", spanText(summary.planets));
  if (summary.belts.max > 0) {
    const kinds = featureText(summary.belt_kinds);
    add("Belts", kinds === "" ? spanText(summary.belts) : `${spanText(summary.belts)} (${kinds})`);
  }
  add("Notable", featureText([...summary.named_bodies, ...summary.notable_classes]));
  add("Modifiers", featureText(summary.modifiers));
  const planted = (summary.comes_with ?? []).map((planting) => planting.name);
  const without = summary.comes_without ?? [];
  const leftOut = without.flatMap((left) =>
    left === "cluster_systems" ? [] : [LEFT_OUT_WORDS[left]],
  );
  if (how.kind === "built") {
    add("Comes with", how.extras ? planted.join(", ") : "");
    add("Comes without", [...(how.extras ? [] : planted), ...leftOut].join(", "));
  }
  if (summary.dlc) add("DLC", summary.dlc.name);
  const inGalaxy = summary.in_galaxy ?? 0;
  const cap = summary.max_instances;
  const limit = cap === 1 ? "One per galaxy." : `Up to ${cap} per galaxy.`;
  const unique =
    cap === null
      ? null
      : inGalaxy >= cap
        ? {
            text: `${limit} Already in this galaxy (${inGalaxy}). You can still place it.`,
            warn: true,
          }
        : {
            text:
              inGalaxy === 0 ? `${limit} Not in this galaxy yet.` : `${limit} ${inGalaxy} so far.`,
            warn: false,
          };
  const storyKept = !summary.story_kept_by_existing
    ? null
    : typeof name === "string"
      ? `${name} is already in this galaxy, so its event chain stays with that one.`
      : `${capitalised(name.phrase)} are already in this galaxy, so their event chain stays with those.`;
  const dlc = summary.dlc;
  const missingDlc =
    how.kind === "built" && dlc && !dlc.met
      ? `This save doesn't have ${dlc.name}, so its events won't run.`
      : null;
  const clusterSystems = without.includes("cluster_systems") ? CLUSTER_SYSTEMS : null;
  return { lines, unique, storyKept, missingDlc, clusterSystems };
}

/** The marks a row of the Special picker carries. */
export interface SpecialMarks {
  /** A layout the galaxy already holds as many of as the game places, `cap`. */
  inGalaxy: boolean;
  /** The layout's DLC: a tag when the save has it, a lock when it doesn't. */
  dlc: "tag" | "lock" | null;
}

/**
 * The marks of a layout or a cluster, which the galaxy holds `in_galaxy` of and `cap` at most. Its
 * DLC is a tag where the document has no DLC to check it against: the `script` kind of add.
 */
export function specialMarks(
  pick: { in_galaxy: number; dlc: DlcNeed | null },
  cap: number | null,
  how: LayoutAdd["kind"] = "built",
): SpecialMarks {
  return {
    inGalaxy: cap !== null && pick.in_galaxy >= cap,
    dlc: pick.dlc === null ? null : pick.dlc.met || how === "script" ? "tag" : "lock",
  };
}
