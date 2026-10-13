import type { PlanetPage } from "../generated/PlanetPage";
import { planetSummary } from "../store/fixture";
import { heldAnomaly, savePickerTarget } from "../store/planetEditAdapter";

/** Save body `page` in system 1, as its page hands it to the pickers. */
export const pickerTarget = (page: PlanetPage) =>
  savePickerTarget(
    1,
    planetSummary({ id: page.id, class: page.class, size: page.size }),
    page,
    heldAnomaly(page),
  );
