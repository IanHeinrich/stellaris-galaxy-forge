/**
 * Rolling a planet or moon into a save system.
 * Command and argument names match `app/src-tauri/src/commands/add_body.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AddedBody } from "../generated/AddedBody";
import type { BodyClassPick } from "../generated/BodyClassPick";

/**
 * Roll a body from `seed` and add it to system `system` of the open save as one edit, `radius`
 * from what it orbits at `angle` degrees: a moon of `parent`, or a planet for null. It is of
 * `planetClass` and `size` when given, else drawn as the game draws them, with the deposits it
 * rolls. Answers with the edit and the new body's id; refused without game data.
 */
export function addBody(
  system: number,
  parent: number | null,
  planetClass: string | null,
  size: number | null,
  radius: number,
  angle: number,
  seed: number,
): Promise<AddedBody> {
  return invoke<AddedBody>("add_body", {
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
