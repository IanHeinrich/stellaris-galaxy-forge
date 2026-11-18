/**
 * How the system view's Add megastructure works in the open document, chosen once by what its
 * capabilities say an add writes: a save adds a row the system's owner gets, on any body or in
 * empty space; a scenario places a ruin with no owner, on its main star or at a point.
 */
import type { Capabilities } from "../generated/Capabilities";
import { SCENARIO_STAR_BODY } from "../generated/constants";
import type { MegastructureAdds } from "../generated/MegastructureAdds";
import type { PlanetSummary } from "../generated/PlanetSummary";
import { MAIN_STAR_ONLY, ROLLED_BODY_REFUSAL } from "./megastructureCopy";

/** What the menu reads of the body it was opened on. */
export interface SpotBody {
  id: number;
  star: boolean;
  /** The game rolls its class, or whether it spawns, when it makes the galaxy. */
  rolled: boolean;
}

export interface MegastructureAddForm {
  /** The dialog's Owner row: the added row goes to the system's owner. */
  owner: boolean;
  /**
   * The dialog's closing line for a megastructure of one stage, which says it is added at the
   * stage picked.
   */
  oneStageFooter: boolean;
  /** Why the menu on `body` can't add one there; null when it can. */
  bodyRefusal(body: SpotBody): string | null;
}

const SAVE_ADD: MegastructureAddForm = {
  owner: true,
  oneStageFooter: true,
  bodyRefusal: () => null,
};

const RUIN_ADD: MegastructureAddForm = {
  owner: false,
  oneStageFooter: false,
  bodyRefusal: ({ id, star, rolled }) => {
    if (id === SCENARIO_STAR_BODY) return null;
    return rolled && !star ? ROLLED_BODY_REFUSAL : MAIN_STAR_ONLY;
  },
};

/** The form of each kind of add; a document that adds none never opens the dialog. */
const FORMS: Record<MegastructureAdds, MegastructureAddForm> = {
  none: SAVE_ADD,
  rows: SAVE_ADD,
  ruins: RUIN_ADD,
};

/** The add of a document that supports `capabilities`. */
export function megastructureAddForm(capabilities: Capabilities): MegastructureAddForm {
  return FORMS[capabilities.add_megastructures];
}

/** Whether the game rolls `planet`'s class, or whether it spawns, as its scenario view says. */
export function rolledBody(planet: PlanetSummary): boolean {
  return planet.drawn || planet.spawn?.always === false;
}
