import type { PlanetPage } from "../generated/PlanetPage";
import type { PlanetSummary } from "../generated/PlanetSummary";
import { planetSummary } from "../store/fixture";
import { heldAnomaly, savePickerTarget } from "../store/planetEditAdapter";

/**
 * Save body `page` in system `system`, as its page hands it to the pickers. `summary` is the body's
 * row in the system's details, which defaults to its id, class and size.
 */
export const pickerTarget = (
  page: PlanetPage,
  summary: PlanetSummary = planetSummary({ id: page.id, class: page.class, size: page.size }),
  system = 1,
) => savePickerTarget(system, summary, page, heldAnomaly(page));
