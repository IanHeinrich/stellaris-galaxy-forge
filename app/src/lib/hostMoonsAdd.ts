/**
 * What the Add megastructure dialog says of a type whose build removes the moons of the body it
 * stands on: the choice to remove them as the game does or keep them, and which one the add sends.
 */
import type { HostMoons } from "../generated/HostMoons";
import type { HostMoonsFit } from "../generated/HostMoonsFit";
import type { MegastructureView } from "../generated/MegastructureView";
import { refusalSentence } from "./megastructureCopy";
import type { MegastructureFits } from "./megastructurePicks";

export const HOST_MOONS_LABEL = "Moons";

/** What the add can do with the moons of the body a row of `kind`, the type a stage writes, stands on. */
export function hostMoonsOf(fits: MegastructureFits | null, kind: string): HostMoonsFit {
  const fit = fits === null ? undefined : [...fits.values()].find((f) => f.variant === kind);
  return fit?.host_moons ?? { kind: "kept" };
}

/** The moons choice the dialog shows for `type` at `fit`; null for a type that keeps them, or a body with none. */
export function hostMoonsChoice(
  type: MegastructureView | undefined,
  fit: HostMoonsFit,
): Exclude<HostMoonsFit, { kind: "kept" }> | null {
  if (type?.removes_host_moons !== true || fit.kind === "kept") return null;
  return fit;
}

/**
 * What the add of `kind` does with the moons: keeps them where the save refuses to remove them or
 * the player kept them for `kind`, which `keptFor` names; else removes them, as the game does.
 */
export function hostMoonsSent(fit: HostMoonsFit, keptFor: string | null, kind: string): HostMoons {
  return fit.kind === "refused" || keptFor === kind ? "keep" : "remove";
}

/** The choice that removes the moons: "Remove its 3 moons, as the game does"; no count when unknown. */
export function removeMoonsText(count: number | null): string {
  const moons = count === null ? "moons" : count === 1 ? "moon" : `${count} moons`;
  return `Remove its ${moons}, as the game does`;
}

/** The choice that keeps the moons: "Keep its moons", or "Keep its moon" for one. */
export function keepMoonsText(count: number | null): string {
  return count === 1 ? "Keep its moon" : "Keep its moons";
}

/** Why Remove is off, as a sentence. */
export function moonsRefusal(choice: Extract<HostMoonsFit, { kind: "refused" }>): string {
  return refusalSentence(choice.reason);
}
