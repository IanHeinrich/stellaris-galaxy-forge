import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PickerTarget } from "../../../lib/details/picker";
import type { PlanetOffers } from "../../../lib/details/planetOffers";
import type { SaveRowRefs } from "../../../store/planetEditAdapter";

/** What each section of a planet's page reads: the page, what it offers to edit, and the target it edits. */
export interface PlanetSectionProps {
  page: PlanetPage;
  offers: PlanetOffers;
  target: PickerTarget<SaveRowRefs>;
  /** The body's orbit radius, where no Orbit block edits it. */
  radius: number | null;
}
