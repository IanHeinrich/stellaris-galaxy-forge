/**
 * Rolling a planet or moon into a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_body.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Added } from "../generated/Added";
import type { BodyClassPick } from "../generated/BodyClassPick";

/**
 * Calls `add_body`: roll a body from `seed` into system `system`, a moon of `parent` or a planet
 * for null, `radius` out at `angle` degrees. A null `planetClass` or `size` is drawn. The command's
 * doc says what it rolls and refuses.
 */
export function addBody(
  system: number,
  parent: number | null,
  planetClass: string | null,
  size: number | null,
  radius: number,
  angle: number,
  seed: number,
): Promise<Added> {
  return invoke<Added>("add_body", {
    system,
    parent,
    class: planetClass,
    size,
    radius,
    angle,
    seed,
  });
}

/**
 * The classes a planet, or with `moon` a moon, added to a save may take, each with its name and
 * the sizes a random one is drawn from, by name; empty without game data.
 */
export function getBodyClasses(moon: boolean): Promise<BodyClassPick[]> {
  return invoke<BodyClassPick[]>("get_body_classes", { moon });
}
