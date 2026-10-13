/**
 * What the Add megastructure menu items and dialog say: their labels, the notes on what Add
 * writes and who owns it, the Where line, a stage's line and the Add button.
 */
import type {
  MegastructureChain,
  MegastructureEntry,
  MegastructureSpot,
  MegastructureStage,
} from "./megastructurePicks";
import { orbitText, placementAt } from "./planetMove";
import { RING_WRITTEN } from "./ringWorldAdd";
import { capitalised, needsGameData } from "./text";

export const ADD_MEGASTRUCTURE_HERE_LABEL = "Add megastructure here…";
export const ADD_MEGASTRUCTURE_LABEL = "Add megastructure…";
export const MEGASTRUCTURES_NEED_GAME_DATA = needsGameData("add a megastructure");
export const NO_MEGASTRUCTURE_FITS = "No megastructure can go here.";
/** What the dialog says while it asks the save what goes at the spot. */
export const READING_FITS = "Checking what can go here…";

/** Why Add wrote nothing: the dialog hadn't read where the megastructure stands. */
export const NOT_PLACED =
  "Galaxy Forge hadn't finished checking what can go here, so nothing was added. Open the dialog again.";

/** What the dialog says when it can't learn what goes at the spot. */
export function fitsUnread(why: string): string {
  return `Couldn't check what can go here: ${why}`;
}

/** Why the save refuses a stage, as a sentence: the core's reason, capitalised and stopped. */
export function refusalSentence(reason: string): string {
  const text = capitalised(reason.trim());
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** What the dialog says before Add. */
export const WRITTEN_FINISHED =
  "The megastructure is added already built, at the stage you picked.";
/**
 * What the dialog says before Add of a type whose finished stage is a habitat, in a system an
 * empire owns when `owned`.
 */
export function writtenAsHabitat(owned: boolean): string {
  const skin = owned
    ? "It has the habitat skin of the empire that owns the system."
    : "No one owns the system, so it has the default habitat skin.";
  return `The habitat is added already built, as a planet with no colony. ${skin}`;
}
/** What the dialog says of a habitat's owner. */
export const HABITAT_OWNER_NOTE = "A habitat is added with no owner.";
/** What the dialog says of the owner of the major orbital that comes with a habitat. */
export const HABITAT_ORBITAL_OWNER_NOTE =
  "Its major orbital goes to the empire that owns the system.";
/** Why a habitat comes with no major orbital. */
export const HABITAT_ORBITAL_HOST_TAKEN =
  "The planet or star it orbits already has a megastructure, so no major orbital is added.";
/**
 * What the dialog says of the major orbital that comes with a habitat, in a system an empire
 * owns when `owned`, and `hostTaken` when the habitat's host holds a megastructure already.
 */
export function habitatOrbitalNote(owned: boolean, hostTaken: boolean): string {
  if (hostTaken) return HABITAT_ORBITAL_HOST_TAKEN;
  const owner = owned ? "owned by the empire that owns the system" : "with no owner";
  return `A major orbital is added at the planet or star it orbits, ${owner}.`;
}

/** What the dialog calls a ring world, its tile that adds the whole ring, and the list's summary of it. */
export const RING_WORLD_LABEL = "Ring World";
export const RING_STAGE = "Ring";
export const RING_WORLD_SUMMARY = "Site or whole ring";

export const BASE_GAME = "Base game";
export const UNNAMED_TYPES = "Unnamed megastructures";

/**
 * The heading the list shows `entry` under: its mod's name, `Base game`, or
 * `Unnamed megastructures` for one the game names nothing of, which the list shows last.
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
export const NO_OWNER_NOTE = "No one owns the system, so the megastructure has no owner.";

/**
 * The dialog's Owner line: who the megastructure goes to, `ownerName` naming the empire that owns
 * the system, and the note after it. `orbitHosted` when a habitat's major orbital comes with it.
 */
export function ownerLine(
  habitat: boolean,
  owner: number | null,
  ownerName: string | null,
  orbitHosted: boolean,
): { name: string; note: string } {
  if (habitat) {
    const orbital = orbitHosted && owner !== null ? ` ${HABITAT_ORBITAL_OWNER_NOTE}` : "";
    return { name: NO_OWNER, note: `${HABITAT_OWNER_NOTE}${orbital}` };
  }
  if (owner === null) return { name: NO_OWNER, note: NO_OWNER_NOTE };
  return { name: ownerName ?? `Empire #${owner}`, note: OWNER_NOTE };
}

/** What the type being added is, as the dialog's closing line tells it. */
export interface AddedKind {
  ring: boolean;
  habitat: boolean;
  /** A habitat whose type adds a major orbital at its host. */
  orbital: boolean;
}

/**
 * The dialog's closing line: what Add writes, in a system an empire owns when `owned`, with
 * `orbitHosted` when a habitat's major orbital comes with it, and `planetNote`, what happens to the
 * planet the megastructure changes, after anything but a ring world.
 */
export function footerLine(
  kind: AddedKind,
  owned: boolean,
  orbitHosted: boolean,
  planetNote: string,
): string {
  const written = kind.ring
    ? RING_WRITTEN
    : kind.habitat
      ? writtenAsHabitat(owned)
      : WRITTEN_FINISHED;
  const orbital = kind.habitat && kind.orbital ? ` ${habitatOrbitalNote(owned, !orbitHosted)}` : "";
  return `${written}${orbital}${kind.ring ? "" : planetNote}`;
}

/** What the dialog says of a type it has no model for. */
export const NO_MODEL = "No model yet";
export const NO_MODEL_NOTE = "Galaxy Forge can't show this megastructure's model yet.";

/**
 * The notice after an add that left out effects of its construction: `unsure` the editor could not
 * tell apply, `unwritten` that apply but that it does not write. Null when it left out none.
 */
export function leftOutNotice(name: string, unsure: number, unwritten: number): string | null {
  if (unsure === 0 && unwritten === 0) return null;
  const parts = [`Added the ${name}.`];
  if (unsure === 1) {
    parts.push(
      "Galaxy Forge couldn't tell whether 1 effect of building it applies here, so it left that out.",
    );
  } else if (unsure > 1) {
    parts.push(
      `Galaxy Forge couldn't tell whether ${unsure} effects of building it apply here, so it left them out.`,
    );
  }
  if (unwritten === 1) {
    parts.push("Galaxy Forge can't add 1 effect of building it yet, so it left that out.");
  } else if (unwritten > 1) {
    parts.push(
      `Galaxy Forge can't add ${unwritten} effects of building it yet, so it left them out.`,
    );
  }
  return parts.join(" ");
}

/** The dialog's Where line: around the body, or where in the system the row stands. */
export function whereText(spot: MegastructureSpot, bodyName: string | undefined): string {
  if (spot.kind === "body") return `Around ${bodyName ?? `#${spot.body}`}`;
  const at = placementAt(spot.x, spot.y);
  return `At ${orbitText(at)}`;
}
