/**
 * Paint a Galaxy: the site's address, its companion mod on the Steam Workshop, and the seats
 * its spawn script names.
 */

import type { ModView } from "../generated/ModView";
import type { PaintSpawnKind } from "../generated/PaintSpawnKind";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemNode } from "../generated/SystemNode";

/** The published site; also the one address the shell's `open_url` allows. */
export const PAINT_URL = "https://oatmealproblem.github.io/paint-a-galaxy/";

/** The companion mod on the Steam Workshop, whose fixes a painted galaxy needs. */
export const PAINT_MOD_WORKSHOP_ID = "3532904115";

const PAINT_MOD_NAME = "paint a galaxy";

/** Whether the site painted this galaxy: any system spawns through its script. */
export function isPaintMade(systems: readonly SystemNode[]): boolean {
  return systems.some((s) => s.spawn_script !== null);
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

/** Every seat the site knows: enabled, preferred, one reservation per letter, and Sol. */
export const PAINT_SPAWN_KINDS: readonly PaintSpawnKindOption[] = [
  { key: "enabled", label: "enabled" },
  { key: "preferred", label: "preferred" },
  ...[...LETTERS].map((letter) => ({
    key: `${RESERVED_PREFIX}${letter}`,
    label: `reserved ${letter.toUpperCase()}`,
  })),
  { key: "sol", label: "Sol" },
];

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

/**
 * Whether the companion mod is in the launcher's playset: the Workshop copy by its id, or a
 * local copy by its name. A listed mod whose files are not found still counts, since the
 * launcher enabled it and the files may sit in a library this editor does not know.
 */
export function isPaintModEnabled(mods: readonly ModView[]): boolean {
  return mods.some(
    (m) => m.id === `ugc_${PAINT_MOD_WORKSHOP_ID}` || m.name.toLowerCase().includes(PAINT_MOD_NAME),
  );
}
