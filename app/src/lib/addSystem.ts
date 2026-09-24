import type { Feature } from "../generated/Feature";
import type { PickSummary } from "../generated/PickSummary";
import type { SaveMeta } from "../generated/SaveMeta";
import type { SystemNode } from "../generated/SystemNode";
import { counted } from "./text";
import type { Span } from "../generated/Span";
import type { SpecialLayout } from "../generated/SpecialLayout";
import { versionNumber } from "./version";

/** How near another system the game spawns one: its `SPAWN_SYSTEM_BUFFER_DISTANCE`. */
export const SPAWN_BUFFER = 10;

export const NEEDS_GAME_DATA = "Load game data to add a system";
export const NEEDS_STELLARIS_4 = "Adding systems needs a Stellaris 4 save";
export const IRONMAN = "Ironman save: adding systems is turned off";
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

/** Why a system cannot be added, and which of the spot's limits the map should draw. */
export interface AddRefusal {
  reason: string;
  /** Another system is inside the spawn buffer around the spot. */
  tooClose: boolean;
  /** The spot is past the galaxy's edge. */
  outside: boolean;
}

function refusal(reason: string, tooClose = false, outside = false): AddRefusal {
  return { reason, tooClose, outside };
}

/** Whether the save's version is Stellaris 4 or later, the only saves the core adds a system to. */
export function isStellaris4(meta: SaveMeta | null): boolean {
  const major = Number(versionNumber(meta?.version ?? "")?.split(".")[0]);
  return Number.isFinite(major) && major >= 4;
}

/** Why the core would refuse a system at the spot, checked as it checks, or null when it would take one. */
export function addSystemRefusal(facts: PlaceFacts): AddRefusal | null {
  if (!facts.gameData) return refusal(NEEDS_GAME_DATA);
  if (!isStellaris4(facts.meta)) return refusal(NEEDS_STELLARIS_4);
  if (facts.meta?.ironman) return refusal(IRONMAN);
  if (facts.radius > 0 && Math.hypot(facts.x, facts.y) > facts.radius) {
    return refusal(`Outside the galaxy's edge (radius ${Math.round(facts.radius)})`, false, true);
  }
  const near = facts.nearest;
  if (near && near.distance < SPAWN_BUFFER) {
    const away = Math.max(1, Math.round(near.distance));
    return refusal(`Too close to ${near.name}: ${away} away, the game needs ${SPAWN_BUFFER}`, true);
  }
  return null;
}

/** A fresh seed for the generator: a random whole number JSON carries exactly. */
export function newSeed(): number {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return (high & 0x1fffff) * 0x100000000 + low;
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
  /** The line saying the save lacks the layout's DLC; null when it has it or needs none. */
  missingDlc: string | null;
}

function spanText({ min, max }: Span): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

function featureText(features: Feature[]): string {
  return features.map((f) => (f.every ? f.name : `${f.name} (sometimes)`)).join(", ");
}

function starText(names: string[]): string {
  if (names.length > 3) return `One of ${names.length} classes`;
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The hover card of a pick of the Add system menu, leaving out the lines it has nothing for. */
export function pickCard(summary: PickSummary): PickCardCopy {
  const lines: CardLine[] = [];
  const add = (label: string, text: string) => {
    if (text !== "") lines.push({ label, text });
  };
  add("Star", starText(summary.star_classes.map((c) => c.name)));
  add("Planets", spanText(summary.planets));
  if (summary.belts.max > 0) {
    const kinds = featureText(summary.belt_kinds);
    add("Belts", kinds === "" ? spanText(summary.belts) : `${spanText(summary.belts)} (${kinds})`);
  }
  add("Notable", featureText([...summary.named_bodies, ...summary.notable_classes]));
  add("Modifiers", featureText(summary.modifiers));
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
  const dlc = summary.dlc;
  const missingDlc =
    dlc && !dlc.met ? `This save doesn't have ${dlc.name}, so its events won't run.` : null;
  return { lines, unique, missingDlc };
}

/** The marks a Special menu row carries. */
export interface SpecialMarks {
  /** A layout the galaxy already holds as many of as the game places, `cap`. */
  inGalaxy: boolean;
  /** The layout's DLC: a tag when the save has it, a lock when it doesn't. */
  dlc: "tag" | "lock" | null;
}

export function specialMarks(layout: SpecialLayout, cap: number | null): SpecialMarks {
  return {
    inGalaxy: cap !== null && layout.in_galaxy >= cap,
    dlc: layout.dlc === null ? null : layout.dlc.met ? "tag" : "lock",
  };
}
