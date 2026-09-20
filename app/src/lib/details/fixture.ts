/** The system, planet, fleet and country a details test starts from. */
import type { CountryNode } from "../../generated/CountryNode";
export {
  systemDetails as details,
  fleetSummary as fleet,
  planetSummary as planet,
} from "../../test/builders";

export const COUNTRY: CountryNode = {
  id: 3,
  name: { key: "NAME_Earth", literal: false, variables: [] },
  name_key: "NAME_Earth",
  country_type: "default",
  capital_system: null,
  system_count: 0,
  colors: ["blue", "black"],
  flag_icon: { category: "human", file: "flag_human_9.dds" },
  flag_background: { category: "backgrounds", file: "00_solid.dds" },
};
