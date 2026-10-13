/**
 * What the Add megastructure menu items and dialog say: their labels, the notes on what Add
 * writes and who owns it, the Where line, a stage's line and the Add button.
 */
import type { MegastructureView } from "../generated/MegastructureView";
import type {
  MegastructureChain,
  MegastructureEntry,
  MegastructureSpot,
  MegastructureStage,
} from "./megastructurePicks";
import { orbitText, placementAt } from "./planetMove";
import { capitalised } from "./text";

export const ADD_MEGASTRUCTURE_HERE_LABEL = "Add megastructure here…";
export const ADD_MEGASTRUCTURE_LABEL = "Add megastructure…";
export const MEGASTRUCTURES_NEED_GAME_DATA = "Load game data to add a megastructure.";
export const NO_MEGASTRUCTURE_FITS = "No megastructure the game data defines can go here.";
/** What the dialog says while it asks the save what goes at the spot. */
export const READING_FITS = "Reading what can go here…";

/** What the dialog says when it can't learn what goes at the spot. */
export function fitsUnread(why: string): string {
  return `Couldn't read what can go here: ${why}`;
}

/** Why the save refuses a stage, as a sentence: the core's reason, capitalised and stopped. */
export function refusalSentence(reason: string): string {
  const text = capitalised(reason.trim());
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** What the dialog says before Add. */
export const WRITTEN_FINISHED = "The megastructure is added finished.";
/**
 * What the dialog says before Add of a type whose finished stage is a habitat, in a system an
 * empire owns when `owned`.
 */
export function writtenAsHabitat(owned: boolean): string {
  const skin = owned
    ? "It has the habitat skin of the empire that owns the system."
    : "No one owns the system, so it has the habitat class's default skin.";
  return `The habitat is added finished, as a planet with no colony. ${skin}`;
}
/** What the dialog says of a habitat's owner. */
export const HABITAT_OWNER_NOTE = "A habitat is added with no owner.";
/** What the dialog says of the owner of the major orbital that comes with a habitat. */
export const HABITAT_ORBITAL_OWNER_NOTE =
  "Its major orbital goes to the empire that owns the system.";
/** Why a habitat comes with no major orbital. */
export const HABITAT_ORBITAL_HOST_TAKEN =
  "Its host already has a megastructure, so no major orbital is added.";
/**
 * What the dialog says of the major orbital that comes with a habitat, in a system an empire
 * owns when `owned`, and `hostTaken` when the habitat's host holds a megastructure already.
 */
export function habitatOrbitalNote(owned: boolean, hostTaken: boolean): string {
  if (hostTaken) return HABITAT_ORBITAL_HOST_TAKEN;
  const owner = owned ? "owned by the empire that owns the system" : "with no owner";
  return `A major orbital is added at its host, ${owner}.`;
}

/** What the dialog calls a ring world, its tile that adds the whole ring, and the list's summary of it. */
export const RING_WORLD_LABEL = "Ring World";
export const RING_STAGE = "Ring";
export const RING_WORLD_SUMMARY = "Site or whole ring";

export const BASE_GAME = "Base game";
export const UNNAMED_TYPES = "Unnamed types";

/**
 * The heading the list shows `entry` under: its mod's name, `Base game`, or `Unnamed types` for
 * one the game names nothing of, which the list shows last.
 */
export function entryHeading(entry: MegastructureEntry): string {
  return entry.unnamed ? UNNAMED_TYPES : (entry.section ?? BASE_GAME);
}

/** What a stage's short name falls back to for the last stage of a chain. */
export const FINISHED = "Finished";

/** Whether `stage` is told by its place in a build chain of more than one stage. */
const numbered = (stage: MegastructureStage, chain: MegastructureChain) =>
  chain.kind === "build" && stage.count > 1;

/** `Stage 3 of 4: Maturity`; null for a chain of one, a ruins row or a variant's row. */
export function stageLine(stage: MegastructureStage, chain: MegastructureChain): string | null {
  return numbered(stage, chain) ? `Stage ${stage.index} of ${stage.count}: ${stage.short}` : null;
}

/**
 * The Add button's text: `Add Maturity, stage 3 of 4`, with the stage's full name for a finished
 * one; `Add <name>` for a chain of one, a ruins row or a variant's row.
 */
export function addLabel(stage: MegastructureStage, chain: MegastructureChain): string {
  if (!numbered(stage, chain)) return `Add ${stage.label}`;
  const name = stage.short.startsWith(FINISHED) ? stage.label : stage.short;
  return `Add ${name}, stage ${stage.index} of ${stage.count}`;
}

/** What the dialog says of the owner a new megastructure gets. */
export const OWNER_NOTE = "It goes to the empire that owns the system.";
export const NO_OWNER = "No owner";
export const NO_OWNER_NOTE = "A megastructure goes to the empire that owns its system.";

/** What the dialog says of a type it has no model for. */
export const NO_MODEL = "No model yet";
export const NO_MODEL_NOTE = "Galaxy Forge can't draw this type's model yet.";

/**
 * The notice after an add that left out effects of its construction: `unsure` the editor could not
 * tell apply, `unwritten` that apply but that it does not write. Null when it left out none.
 */
export function leftOutNotice(name: string, unsure: number, unwritten: number): string | null {
  if (unsure === 0 && unwritten === 0) return null;
  const parts = [`Added the ${name}.`];
  if (unsure === 1) {
    parts.push(
      "Galaxy Forge couldn't tell whether 1 of its construction's effects applies, so it left it out.",
    );
  } else if (unsure > 1) {
    parts.push(
      `Galaxy Forge couldn't tell whether ${unsure} of its construction's effects apply, so it left them out.`,
    );
  }
  if (unwritten === 1) {
    parts.push(
      "Galaxy Forge doesn't write 1 of its construction's effects yet, so it left it out.",
    );
  } else if (unwritten > 1) {
    parts.push(
      `Galaxy Forge doesn't write ${unwritten} of its construction's effects yet, so it left them out.`,
    );
  }
  return parts.join(" ");
}

/** Whether a type stands just outside the system's inner radius, as relays and gateways do. */
function outsideGravityWell(type: MegastructureView | undefined): boolean {
  return type?.placement.place === "free" && type.placement.outside_gravity_well;
}

/** The dialog's Where line: around the body, or where in the system the row stands. */
export function whereText(
  spot: MegastructureSpot,
  type: MegastructureView | undefined,
  bodyName: string | undefined,
): string {
  if (spot.kind === "body") return `Around ${bodyName ?? `#${spot.body}`}`;
  const at = placementAt(spot.x, spot.y);
  if (outsideGravityWell(type)) return `Just outside the inner radius, at ${at.angle}°`;
  return `At ${orbitText(at)}`;
}
