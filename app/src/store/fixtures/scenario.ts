import type { CountryNode } from "../../generated/CountryNode";
import type { ReferenceVia } from "../../generated/ReferenceVia";
import type { ScenarioBypasses } from "../../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../../generated/ScenarioOwners";
import type { ScriptSite } from "../../generated/ScriptSite";
import type { SystemNode } from "../../generated/SystemNode";
import type { SystemOwner } from "../../generated/SystemOwner";
import type { SystemScripts } from "../../generated/SystemScripts";
import { newFeZone } from "../../lib/feZone";
import { name } from "../../test/builders";
import { SYSTEMS } from "./galaxy";

/** The territory a scenario's scripts hand out, with the synthetic id the backend gives it. */
export const TERRITORY: CountryNode = {
  id: 0x3000_0000,
  name: name("NAME_Fixture_Empire"),
  name_key: "NAME_Fixture_Empire",
  country_type: "default",
  capital_system: 1,
  system_count: 2,
  colors: ["fixture_red", "fixture_red"],
  border_color: null,
  fill_color: null,
  use_map_color: false,
  flag_icon: null,
  flag_background: null,
};

/** The territory Sol joins: claimed on day one, by a claim this editor cannot judge. */
export const DAY_ONE_TERRITORY: CountryNode = {
  id: 0x3000_0001,
  name: name("NAME_Fixture_Day_One_Empire"),
  name_key: "NAME_Fixture_Day_One_Empire",
  country_type: "default",
  capital_system: 0,
  system_count: 1,
  colors: ["fixture_blue", "fixture_blue"],
  border_color: null,
  fill_color: null,
  use_map_color: false,
  flag_icon: null,
  flag_background: null,
};

/**
 * One territory over Alpha Centauri and Barnard, one day-one territory over Sol, and a Sirius
 * whose owner no script resolves.
 */
export const SCENARIO_OWNERS: ScenarioOwners = {
  territories: [
    {
      token: "fixture_empire",
      identity: "created",
      origin: null,
      defined_at: null,
      country: TERRITORY,
      tier: "generation",
      assumed: false,
      claimed_by: [],
    },
    {
      token: "fixture_day_one_empire",
      identity: "created",
      origin: null,
      defined_at: null,
      country: DAY_ONE_TERRITORY,
      tier: "day_one",
      assumed: true,
      claimed_by: ["fixture.2"],
    },
  ],
  // Sol's own SystemOwner is DAY_ONE_OWNER below, kept out of this list so the galaxy fixture's
  // stamped systems (1, 2) stay exactly what the galaxyStore tests already assert on.
  owners: [
    { system: 1, territory: TERRITORY.id, tier: "generation", claimed_by: null, assumed: false },
    { system: 2, territory: TERRITORY.id, tier: "generation", claimed_by: null, assumed: false },
  ],
  unresolved: [{ system: 3, wrote: "set_owner = prev" }],
  colonies: [],
  day_one_systems: 1,
  assumed_systems: 1,
  with_game_data: true,
};

/**
 * What a scenario's game data places: a wormhole pair between Alpha Centauri and Barnard from
 * their initializers, a ruined gateway an event puts at Sol, a lone day-one endpoint at Deneb,
 * and the pairs the game itself scatters.
 */
export const SCENARIO_BYPASSES: ScenarioBypasses = {
  bypasses: [
    {
      system: 1,
      kind: { type: "wormhole" },
      partner: 2,
      source: { type: "initializer", key: "wormhole_a_init" },
      assumed: false,
    },
    {
      system: 2,
      kind: { type: "wormhole" },
      partner: 1,
      source: { type: "initializer", key: "wormhole_b_init" },
      assumed: false,
    },
    {
      system: 0,
      kind: { type: "gateway", ruined: true },
      partner: null,
      source: { type: "day_one", event: "fixture.9" },
      assumed: true,
    },
    {
      system: 5,
      kind: { type: "wormhole" },
      partner: null,
      source: { type: "day_one", event: "fixture.8" },
      assumed: false,
    },
  ],
  random_wormhole_pairs: 3,
  random_gateways: 1,
  open_endpoints: 0,
  with_game_data: true,
};

/** Sol's owner: the day-one territory's claim, which a test joins onto `SCENARIO_OWNERS` itself. */
export const DAY_ONE_OWNER: SystemOwner = {
  system: 0,
  territory: DAY_ONE_TERRITORY.id,
  tier: "day_one",
  claimed_by: "fixture.2",
  assumed: true,
};

const MOD = "C:/mods/one";

/** One line of one script: the path the section shows, and the file the actions open. */
function scriptSite(
  root: string | null,
  path: string,
  line: number,
  layer: string,
  via: ReferenceVia | null,
  token: string | null,
): ScriptSite {
  return {
    location: {
      file: root === null ? null : `${root}/${path}`,
      display: `${path}:${line}`,
      line,
      layer,
    },
    via,
    token,
  };
}

/** Every row kind the section groups: the pinned pair first, then a script named on three lines. */
export const SYSTEM_SCRIPTS: SystemScripts = {
  system: 1,
  initializer: {
    file: `${MOD}/common/solar_system_initializers/zz_one.txt`,
    display: "common/solar_system_initializers/zz_one.txt:12",
    line: 12,
    layer: "one",
  },
  owner: {
    token: "fixture_empire",
    territory: TERRITORY.id,
    label: "Fixture Empire",
    capital: true,
    tier: "generation",
    claimed_by: null,
    assumed: false,
  },
  rows: [
    {
      kind: "initializer",
      name: "empire_capital_init",
      title: "Fixture Capital",
      timing: "generation",
      fired_by: null,
      sites: [
        scriptSite(
          MOD,
          "common/solar_system_initializers/zz_one.txt",
          12,
          "one",
          "initializer",
          "empire_capital_init",
        ),
      ],
      site_count: 1,
      vias: ["initializer"],
      pinned: true,
    },
    {
      kind: "scenario_effect",
      name: "effect",
      title: null,
      timing: "generation",
      fired_by: null,
      sites: [scriptSite(null, "my_galaxy.txt", 41, "scenario", null, null)],
      site_count: 1,
      vias: [],
      pinned: true,
    },
    {
      kind: "scripted_effect",
      name: "create_fixture_empire",
      title: null,
      timing: "unknown",
      fired_by: null,
      sites: [
        scriptSite(MOD, "common/scripted_effects/zz_countries.txt", 3, "one", "call", null),
        scriptSite(
          MOD,
          "common/scripted_effects/zz_countries.txt",
          19,
          "one",
          "call",
          "create_fixture_empire",
        ),
        scriptSite(
          MOD,
          "common/scripted_effects/zz_countries.txt",
          27,
          "one",
          "star_flag",
          "fixture_core",
        ),
      ],
      site_count: 3,
      vias: ["call", "star_flag"],
      pinned: false,
    },
    {
      kind: "event",
      name: "distar.290",
      title: "The Beacon Wakes",
      timing: "generation",
      fired_by: "on_game_start",
      sites: [
        scriptSite(MOD, "events/zz_fixture_events.txt", 7, "one", "star_flag", "fixture_beacon"),
      ],
      site_count: 1,
      vias: ["star_flag"],
      pinned: false,
    },
    {
      kind: "on_action",
      name: "on_colony_founded",
      title: null,
      timing: "later",
      fired_by: null,
      sites: [
        scriptSite(
          "C:/Stellaris",
          "common/on_actions/00_on_actions.txt",
          88,
          "vanilla",
          "event_target",
          "fixture_empire",
        ),
      ],
      site_count: 1,
      vias: ["event_target"],
      pinned: false,
    },
  ],
  truncated: false,
};

/** Sirius anchoring a zone south at 40 whose connections it takes under id 2. */
export const FE_LINK_ANCHOR: SystemNode = {
  ...SYSTEMS[3],
  fe_zone: newFeZone("s"),
  fe_link: { custom: true, id: 2, to: [] },
};

/** Deneb, linked to the zone `FE_LINK_ANCHOR` anchors. */
export const FE_LINKED: SystemNode = {
  ...SYSTEMS[5],
  fe_link: { custom: false, id: null, to: [2] },
};
