import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";
import * as ipc from "../../../api/ipc";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEntityStore } from "../../../store/entityStore";
import {
  colonyTypeView,
  countryNode,
  depositTypeView,
  modifierLine,
  name,
  planetPage,
} from "../../../store/fixture";
import { useInspectorStore, type Entry, type InspectorTab } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { heldAnomaly, savePickerTarget } from "../../../store/planetEditAdapter";
import { armStarClasses as armClasses } from "../../../store/storeFixture";
import { details, land, planet, SYSTEM } from "../inspectorFixture";
import { PlanetView } from "./PlanetView";

/** What the body page tests share: the bodies they open, and how a page is read and drawn. */

/** The head the generic entity view draws for a planet. */
export const GENERIC_HEAD = '<div class="ins-sub muted">planet</div>';

export const STAR = 101;
export const WORLD = 100;
export const EMPIRE = 16;

/** The install's classes for a binary of a Class A star and a pulsar, and a Class G star. */
export function armStarClasses(): void {
  armClasses(
    { sc_a: ["pc_a_star"], sc_g: ["pc_g_star"], sc_binary_1: ["pc_a_star", "pc_pulsar"] },
    {
      pc_a_star: "Class A Star",
      pc_g_star: "Class G Star",
      pc_pulsar: "Pulsar",
      pc_continental: "Continental World",
      pc_barren_cold: "Barren World",
    },
    ["pc_continental", "pc_barren_cold"],
  );
}

export const stars = () =>
  details({
    planets: [
      planet(WORLD, "Tarkin"),
      planet(STAR, "Alpha", { class: "pc_a_star", size: 30 }),
      planet(102, "Beta", { class: "pc_pulsar" }),
    ],
  });

export const EMPIRE_NODE = countryNode({
  id: EMPIRE,
  name: name("NAME_Ti_Zru_Conservers"),
  name_key: "NAME_Ti_Zru_Conservers",
  country_type: "fallen_empire",
  capital_system: SYSTEM,
  system_count: 1,
  colors: ["dark_teal", "dark_teal"],
});

/** Body `page` as its system's details list it. */
export function summaryOf(page: PlanetPage): PlanetSummary {
  return planet(page.id, page.name_key, {
    name: page.name,
    class: page.class,
    size: page.size,
    colonised: page.colony !== null,
    owner: page.owner,
    ...(page.entity_name === null ? {} : { entity_name: page.entity_name }),
    ...(page.anomaly === null ? {} : { anomaly: page.anomaly.category }),
  });
}

/** Save body `page` in system `SYSTEM`, as its page hands it to the pickers. */
export const pickerTarget = (page: PlanetPage) =>
  savePickerTarget(SYSTEM, summaryOf(page), page, heldAnomaly(page));

/**
 * Answers the read of `page` as the save does, once it has landed in the store, with the body in
 * its system's details unless they already list it.
 */
export async function landPage(page: PlanetPage): Promise<void> {
  const known = useDetailsStore.getState().details.get(SYSTEM) ?? details();
  if (!known.planets.some((p) => p.id === page.id)) {
    await land({ ...known, planets: [...known.planets, summaryOf(page)] });
  }
  await answerPage(page);
}

/** Answers the read of `page` as the save does, leaving its system's details as they are. */
export async function answerPage(page: PlanetPage): Promise<void> {
  vi.mocked(ipc.getPlanetPage).mockResolvedValueOnce(page);
  useEntityStore.getState().requestPlanetPage(page.id);
  await vi.waitFor(() => expect(useEntityStore.getState().pages.get(page.id)).toBe(page));
}

/** The planet's page on `tab`, drilled onto from its system. */
export function render(id: number, tab: InspectorTab = "overview"): string {
  const entry: Entry = { ref: { kind: "body", system: SYSTEM, id }, label: "Alpha" };
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: SYSTEM }, label: "Alpha Centauri" }, entry],
    tab,
  });
  return renderToStaticMarkup(<PlanetView entry={entry} />);
}

export const PICKER = /class="icon-picker-trigger edit-field"[^>]*>/;

export const districts = (key: string, value: number, words: string) =>
  modifierLine(key, value, `${value > 0 ? "+" : ""}${value} ${words}`);

/** Olbers, an unowned arctic world: blockers, a feature hiding another, and a feature with its timed twin. */
export const OLBERS = planetPage({
  id: WORLD,
  class: "pc_arctic",
  surveyed_by: EMPIRE,
  deposits: [
    { id: 1, kind: "d_massive_glacier", swap_type: "d_crystalline_caverns" },
    { id: 2, kind: "d_frozen_gas_lake", swap_type: null },
    { id: 3, kind: "d_active_volcano", swap_type: null },
  ],
  planet_modifiers: ["pm_abundant_geothermal_activity"],
  timed_modifiers: [{ modifier: "abundant_geothermal_activity", days: -1 }],
});

/** Nekkar I, a fallen empire's colony: five deposits of three types. */
export const NEKKAR_COLONY = planetPage({
  id: WORLD,
  name: name("NAME_Nekkar_I"),
  name_key: "NAME_Nekkar_I",
  class: "pc_tropical",
  owner: EMPIRE,
  controller: EMPIRE,
  parent: STAR,
  orbit: 60,
  deposits: [
    { id: 1, kind: "d_mineral_fields", swap_type: null },
    { id: 2, kind: "d_bubbling_swamp", swap_type: null },
    { id: 3, kind: "d_prosperous_mesa", swap_type: null },
    { id: 4, kind: "d_mineral_fields", swap_type: null },
    { id: 5, kind: "d_bubbling_swamp", swap_type: null },
  ],
  colony: {
    id: 29,
    colonised: "2200.01.01",
    final_designation: "col_fe_colony",
    designation: null,
    pops: 1600,
    species: [
      { id: 20, name: name("SPEC_Ti-Zru"), pops: 800 },
      { id: 22, name: name("NAME_Synthetic"), pops: 800 },
    ],
    districts: [{ kind: "district_mining", level: 2 }],
    zones: [],
    buildings: [],
  },
});

/** The game data Nekkar I's deposits and designation read. */
export function armColonyData(): void {
  usePlanetDataStore.setState({
    depositTypes: new Map(
      [
        depositTypeView("d_mineral_fields", {
          name: "Mineral Fields",
          effects: [districts("district_mining_max_add", 1, "Max Mining Districts")],
        }),
        depositTypeView("d_prosperous_mesa", {
          name: "Prosperous Mesa",
          effects: [districts("district_mining_max_add", 2, "Max Mining Districts")],
        }),
        depositTypeView("d_bubbling_swamp", {
          name: "Bubbling Swamp",
          rare: true,
          effects: [districts("district_farming_max_add", 3, "Max Agriculture Districts")],
          side_effects: [
            {
              tech: { key: "tech_mine_exotic_gases", name: "Exotic Gas Extraction" },
              effects: [modifierLine("farmer_exotic_gases", 0.05, "+0.05 Farmer Exotic Gases")],
            },
          ],
        }),
      ].map((v) => [v.key, v]),
    ),
    colonyTypes: new Map([
      [
        "col_fe_colony",
        colonyTypeView("col_fe_colony", {
          name: "Fallen Empire Colony",
          icon: "sprite:GFX_colony_type#11",
        }),
      ],
    ]),
  });
}
