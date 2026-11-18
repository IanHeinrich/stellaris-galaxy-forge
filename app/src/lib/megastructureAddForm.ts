/**
 * How the system view's Add megastructure works in the open document, chosen once by its
 * capabilities: a save adds a row the system's owner gets, on any body or in empty space; a
 * scenario places a ruin with no owner, on its main star or at a point.
 */
import type { Capabilities } from "../generated/Capabilities";
import { SCENARIO_STAR_BODY } from "../generated/constants";
import { rolledBodyRefusal } from "./megastructureCopy";

export interface MegastructureAddForm {
  /** The dialog's Owner row: the added row goes to the system's owner. */
  owner: boolean;
  /** Why the menu on body `id`, a star when `star`, can't add one there; null when it can. */
  bodyRefusal(id: number, star: boolean): string | null;
}

const SAVE_ADD: MegastructureAddForm = {
  owner: true,
  bodyRefusal: () => null,
};

const RUIN_ADD: MegastructureAddForm = {
  owner: false,
  bodyRefusal: (id, star) => (id === SCENARIO_STAR_BODY ? null : rolledBodyRefusal(star)),
};

/** The add of a document that supports `capabilities`. */
export function megastructureAddForm(capabilities: Capabilities): MegastructureAddForm {
  return capabilities.place_structures ? RUIN_ADD : SAVE_ADD;
}
