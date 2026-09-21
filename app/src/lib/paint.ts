/**
 * Paint a Galaxy: the site's address, its companion mod on the Steam Workshop, and the seats
 * its spawn script names.
 */

import type { DocumentKind } from "../generated/DocumentKind";
import type { PaintModView } from "../generated/PaintModView";
import type { PaintSpawnKind } from "../generated/PaintSpawnKind";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemNode } from "../generated/SystemNode";
import { isUnder } from "./paths";

/** The published site; also the one address the shell's `open_url` allows. */
export const PAINT_URL = "https://oatmealproblem.github.io/paint-a-galaxy/";

/** The companion mod on the Steam Workshop, whose fixes a painted galaxy needs. */
export const PAINT_MOD_WORKSHOP_ID = "3532904115";

/** The mod's Workshop page; the other address the shell's `open_url` allows. */
export const PAINT_WORKSHOP_URL = `https://steamcommunity.com/sharedfiles/filedetails/?id=${PAINT_MOD_WORKSHOP_ID}`;

/**
 * The Reserved Spawns submod on the Steam Workshop, whose "Reserved Spawn A"–"Z" traits a
 * reserved seat's empire must hold; also allowlisted in the shell's `open_url`.
 */
export const RESERVED_SPAWNS_WORKSHOP_URL =
  "https://steamcommunity.com/sharedfiles/filedetails/?id=3762808682";

/** The facts of the open document the Paint a Galaxy layer is derived from. */
export interface PaintDocument {
  kind: DocumentKind | null;
  path: string | null;
  /** The file carries the site's scripts or flags, or Forge's header for the mod. */
  painted: boolean;
  /** The user asked for the mod's profile when this document was started or opened. */
  paintChosen: boolean;
}

/**
 * Whether the open document is written for the Paint a Galaxy mod: a scenario that is painted,
 * was chosen as one, or lives in the mod's own scenarios folder. Never a save.
 */
export function paintLayer(doc: PaintDocument, paintMod: PaintModView | null): boolean {
  if (doc.kind !== "scenario") return false;
  if (doc.painted || doc.paintChosen) return true;
  const dir = paintMod?.scenarios_dir ?? null;
  return doc.path !== null && dir !== null && isUnder(doc.path, dir);
}

/** The seat a script offers, in a word or two. */
export function spawnScriptLabel(script: SpawnScript): string {
  const { kind } = script.paint_a_galaxy;
  if (kind === "enabled") return "enabled";
  if (kind === "preferred") return "preferred";
  if (kind === "sol") return "Sol";
  return `reserved ${kind.reserved.toUpperCase()}`;
}

/** One choice of seat, keyed for a select. */
export interface PaintSpawnKindOption {
  key: string;
  label: string;
}

const RESERVED_PREFIX = "reserved:";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Every seat the site knows: enabled, preferred, Sol, then one reservation per letter. */
export const PAINT_SPAWN_KINDS: readonly PaintSpawnKindOption[] = [
  { key: "enabled", label: "Enabled" },
  { key: "preferred", label: "Preferred" },
  { key: "sol", label: "Sol" },
  ...[...LETTERS].map((letter) => ({
    key: `${RESERVED_PREFIX}${letter}`,
    label: `Reserved ${letter.toUpperCase()}`,
  })),
];

/**
 * What a seat's kind means, in the site's own terms. For a reserved letter the sentence ends
 * before naming the trait's submod, which a caller with a link to offer appends itself.
 */
export function paintKindDescription(kind: PaintSpawnKind): string {
  if (kind === "enabled") return "Any empire may start here.";
  if (kind === "preferred") {
    return (
      "Filled before enabled seats. In single player the player is seated first, so with one " +
      "preferred seat that is where you start."
    );
  }
  if (kind === "sol") {
    return (
      "Like a reserved seat, and the United Nations of Earth counts as holding it. Set the " +
      "initializer to Sol instead unless this is a modded Sol."
    );
  }
  return `Only an empire whose species has the "Reserved Spawn ${kind.reserved.toUpperCase()}" trait starts here.`;
}

/** The select key of a kind; a reserved letter is lower-cased, as the site writes it. */
export function paintKindKey(kind: PaintSpawnKind): string {
  if (typeof kind === "string") return kind;
  return `${RESERVED_PREFIX}${kind.reserved.toLowerCase()}`;
}

function kindOf(key: string): PaintSpawnKind {
  if (key === "enabled" || key === "preferred" || key === "sol") return key;
  if (key.startsWith(RESERVED_PREFIX)) return { reserved: key.slice(RESERVED_PREFIX.length) };
  throw new Error(`Unknown Paint a Galaxy spawn kind: ${key}`);
}

/**
 * The script that seats `system` as `key` says: its random value is kept when it already has
 * one, and otherwise spread over the site's ten by the system's id.
 */
export function scriptForKind(key: string, system: SystemNode): SpawnScript {
  const random_value = system.spawn_script?.paint_a_galaxy.random_value ?? system.id % 10;
  return { paint_a_galaxy: { kind: kindOf(key), random_value } };
}

/** The script a system is marked with when made a spawn point under the profile. */
export function enabledScript(system: SystemNode): SpawnScript {
  return scriptForKind("enabled", system);
}
