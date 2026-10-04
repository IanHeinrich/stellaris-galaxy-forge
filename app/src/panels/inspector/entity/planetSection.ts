import type { PlanetOffers } from "../../../lib/details/planetOffers";
import type { BodyRead } from "./bodySources";

/** What each section of a body's page reads: the body, and what the page offers to edit. */
export interface PlanetSectionProps {
  read: BodyRead;
  offers: PlanetOffers;
  /** The Orbit block edits the body's orbit, or says it has none, so no section repeats it. */
  orbitEdited: boolean;
}
