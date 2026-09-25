import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import * as ipc from "../../../api/ipc";
import type { PlanetPage } from "../../../generated/PlanetPage";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { planetPageKey, useEntityStore, viewKey } from "../../../store/entityStore";
import {
  colonyTypeView,
  countryNode,
  depositTypeView,
  entityView,
  modifierLine,
  modifierView,
  name,
  planetClassView,
  planetPage,
  resourceAmount,
  starClassView,
} from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry, type InspectorTab } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { READING_STARS } from "../system/StarClassLine";
import { PlanetView } from "./PlanetView";
import { STARS_NEED_GAME_DATA } from "../../../lib/details/starClass";

bindStores();

/** The head the generic entity view draws for a planet. */
const GENERIC_HEAD = '<div class="ins-sub muted">planet</div>';

const STAR = 101;
const WORLD = 100;
const EMPIRE = 16;

/** The install's classes for a binary of a Class A star and a pulsar, and a Class G star. */
function armStarClasses(): void {
  useGameDataStore.setState({
    names: new Map([
      ["pc_a_star", "Class A Star"],
      ["pc_g_star", "Class G Star"],
      ["pc_pulsar", "Pulsar"],
      ["pc_continental", "Continental World"],
      ["pc_barren_cold", "Barren World"],
    ]),
    starClasses: new Map(
      [
        starClassView("sc_a", "pc_a_star"),
        starClassView("sc_g", "pc_g_star"),
        starClassView("sc_binary_1", "pc_a_star", "pc_pulsar"),
      ].map((c) => [c.key, c]),
    ),
    planetClasses: new Map(
      [
        planetClassView("pc_a_star"),
        planetClassView("pc_g_star"),
        planetClassView("pc_pulsar"),
        planetClassView("pc_continental", false),
        planetClassView("pc_barren_cold", false),
      ].map((c) => [c.key, c]),
    ),
  });
}

const stars = () =>
  details({
    planets: [
      planet(WORLD, "Tarkin"),
      planet(STAR, "Alpha", { class: "pc_a_star", size: 30 }),
      planet(102, "Beta", { class: "pc_pulsar" }),
    ],
  });

const EMPIRE_NODE = countryNode({
  id: EMPIRE,
  name: name("NAME_Ti_Zru_Conservers"),
  name_key: "NAME_Ti_Zru_Conservers",
  country_type: "fallen_empire",
  capital_system: SYSTEM,
  system_count: 1,
  colors: ["dark_teal", "dark_teal"],
});

/** Answers the read of `page` as the save does, once it has landed in the store. */
async function landPage(page: PlanetPage): Promise<void> {
  vi.mocked(ipc.getPlanetPage).mockResolvedValueOnce(page);
  useEntityStore.getState().requestPlanetPage(page.id);
  await vi.waitFor(() => expect(useEntityStore.getState().pages.get(page.id)).toBe(page));
}

/** The planet's page on `tab`, drilled onto from its system. */
function render(id: number, tab: InspectorTab = "overview"): string {
  const entry: Entry = { ref: { kind: "planet", id }, label: "Alpha" };
  useInspectorStore.setState({
    stack: [{ ref: { kind: "system", id: SYSTEM }, label: "Alpha Centauri" }, entry],
    tab,
  });
  return renderToStaticMarkup(<PlanetView entry={entry} />);
}

const PICKER = /class="icon-picker-trigger edit-field"[^>]*>/;

const districts = (key: string, value: number, words: string) =>
  modifierLine(key, value, `${value > 0 ? "+" : ""}${value} ${words}`);

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a colony's page", () => {
  const COLONY = planetPage({
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
    },
  });

  function armDeposits(): void {
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

  it("groups its deposits by type, rare first, under the district caps they add up to", async () => {
    await open("save");
    await landPage(COLONY);
    armDeposits();

    const html = render(WORLD);
    expect(html).toContain("Deposits · 5");
    expect(html).toContain('class="pl-caps"');
    expect(html).toMatch(/<b>\+6<\/b> Max Agriculture Districts/);
    expect(html).toMatch(/<b>\+4<\/b> Max Mining Districts/);
    expect(html.indexOf("+6</b> Max Agriculture")).toBeLessThan(html.indexOf("+4</b> Max Mining"));
    expect(html.indexOf("Bubbling Swamp")).toBeLessThan(html.indexOf("Mineral Fields"));
    expect(html.match(/×2/g)).toHaveLength(2);
    expect(html).toContain("+3 Max Agriculture Districts each");
    expect(html).toContain("+2 Max Mining Districts<");
    expect(html).toContain("+0.05 Farmer Exotic Gases with Exotic Gas Extraction");
    expect(html).not.toContain("Blockers");
  });

  it("shows its class and size as text, then the owner, designation, date and pops", async () => {
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage(COLONY);
    armDeposits();

    const html = render(WORLD);
    expect(html).toMatch(/<span class="k">Class<\/span><span>Tropical World<\/span>/);
    expect(html).toMatch(/<span class="k">Size<\/span><span>16<\/span>/);
    expect(html).not.toContain("edit-field");
    expect(html).toContain("Colony");
    expect(html).toContain('title="Open the empire&#x27;s page"');
    expect(html).toContain("Ti Zru Conservers");
    expect(html).toContain("Fallen Empire Colony");
    expect(html).toContain("2200.01.01");
    expect(html).toContain("1,600 · Ti-Zru 800 · Synthetic 800");
    expect(html).toContain('title="Open the colony&#x27;s page"');
    expect(html).toContain("#29");
    for (const left of ["Stability", "Housing", "Amenities", "Habitab", "Ring"]) {
      expect(html).not.toContain(left);
    }
    expect(html).toContain("radius 60");
    expect(html).not.toContain("Controller");
    expect(html.indexOf("Deposits")).toBeLessThan(html.indexOf("Colonised"));
    expect(html.indexOf("Colonised")).toBeLessThan(html.indexOf("About"));
  });
});

describe("an unowned world's page", () => {
  const OLBERS = planetPage({
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

  const blocker = (key: string, label: string, lost: number, days: number, tech: string) =>
    depositTypeView(key, {
      name: label,
      blocker: true,
      effects: [districts("planet_max_districts_add", -lost, "Max Districts")],
      clearing: {
        cost: [resourceAmount("energy", 500 * lost, "Energy Credits")],
        days,
        techs: [{ key: `tech_${key}`, name: tech }],
      },
    });

  it("lists its blockers apart, with their clearing and the feature one hides", async () => {
    await open("save");
    await landPage(OLBERS);
    usePlanetDataStore.setState({
      depositTypes: new Map(
        [
          blocker("d_massive_glacier", "Massive Glacier", 1, 180, "Climate Control Network"),
          blocker("d_active_volcano", "Active Volcano", 2, 270, "Deep Crust Engineering"),
          depositTypeView("d_frozen_gas_lake", {
            name: "Frozen Gas Lake",
            effects: [districts("district_generator_max_add", 2, "Max Generator Districts")],
          }),
          depositTypeView("d_crystalline_caverns", { name: "Crystalline Caverns" }),
        ].map((v) => [v.key, v]),
      ),
    });

    const html = render(WORLD);
    expect(html).toContain("Deposits · 3 · 2 blockers");
    expect(html).toContain("Blockers · 2");
    expect(html.indexOf("Frozen Gas Lake")).toBeLessThan(html.indexOf("Blockers · 2"));
    expect(html.indexOf("Blockers · 2")).toBeLessThan(html.indexOf("Massive Glacier"));
    expect(html).toContain('<span class="l3 pl-hides">Hides Crystalline Caverns</span>');
    expect(html).toContain("Clears for");
    expect(html).toContain("1,000");
    expect(html).toContain(" in 270 days · Deep Crust Engineering");
    expect(html).toContain(" in 180 days · Climate Control Network");
    expect(html).toContain(
      '<span class="pl-cap neg"><span class="gi"></span><b>-3</b> Max Districts',
    );
    expect(html).toContain('<div class="pl-dep blocker">');
    expect(html).not.toContain("Colony");
  });

  it("marks only a loss of districts of every kind with the blocker", async () => {
    await open("save");
    await landPage(
      planetPage({ id: WORLD, deposits: [{ id: 1, kind: "d_open_plains", swap_type: null }] }),
    );
    usePlanetDataStore.setState({
      depositTypes: new Map([
        [
          "d_open_plains",
          depositTypeView("d_open_plains", {
            effects: [districts("planet_max_districts_add", 1, "Max Districts")],
          }),
        ],
      ]),
    });

    expect(render(WORLD)).toContain('<span class="pl-cap"><b>+1</b> Max Districts</span>');
  });

  it("reads a planet modifier with its timed twin as one permanent row", async () => {
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage(OLBERS);
    usePlanetDataStore.setState({
      modifiers: new Map(
        [
          modifierView("pm_abundant_geothermal_activity", {
            name: "Abundant Geothermal Activity",
            static_modifier: "abundant_geothermal_activity",
            effects: [districts("district_generator_max_add", 4, "Max Generator Districts")],
          }),
          modifierView("abundant_geothermal_activity", { name: "Abundant Geothermal Activity" }),
        ].map((v) => [v.key, v]),
      ),
    });

    const html = render(WORLD);
    expect(html).toContain("Modifiers · 1");
    expect(html).toContain("+4 Max Generator Districts · permanent");
    expect(html).toMatch(/Surveyed by<\/span>.*Ti Zru Conservers/);
  });
});

describe("a gas giant's page", () => {
  const STATION = 498;

  it("leads an orbital deposit with its yield and links the station that works it", async () => {
    await open("save");
    await landPage(
      planetPage({
        id: WORLD,
        class: "pc_gas_giant",
        station: STATION,
        deposits: [{ id: 1, kind: "d_trade_value_4", swap_type: null }],
      }),
    );
    const station = { kind: "fleet" as const, id: STATION };
    const stationName = { key: "Nekkar VIII Mining Station", literal: true, variables: [] };
    useEntityStore.setState({
      views: new Map([
        [
          viewKey(station),
          entityView("fleet", { addr: station, name: stationName, label: stationName.key }),
        ],
      ]),
    });
    usePlanetDataStore.setState({
      depositTypes: new Map([
        [
          "d_trade_value_4",
          depositTypeView("d_trade_value_4", {
            name: "+4",
            orbital: true,
            texture_key: "deposit:unused/d_strategic_resources",
            yields: [resourceAmount("trade", 4, "Trade")],
          }),
        ],
      ]),
    });

    const html = render(WORLD);
    expect(html).toMatch(/<span class="res">.*?\+4<\/span>Trade/);
    expect(html).toContain("Worked by");
    expect(html).toContain('title="Open the station&#x27;s fleet"');
    expect(html).toContain("Nekkar VIII Mining Station");
    expect(html).not.toContain('class="pl-caps"');
  });

  it("lists its moons as the system list's rows, each opening its own page", async () => {
    armStarClasses();
    await open("save");
    await land(
      details({
        planets: [
          planet(WORLD, "Nekkar_VIII", { class: "pc_gas_giant" }),
          planet(745, "Nekkar_VIII_a", { class: "pc_barren_cold", moon: true, size: 8 }),
        ],
      }),
    );
    await landPage(
      planetPage({
        id: WORLD,
        class: "pc_gas_giant",
        moons: [
          {
            id: 745,
            name: name("Nekkar_VIII_a"),
            name_key: "Nekkar_VIII_a",
            class: "pc_barren_cold",
            size: 8,
          },
          {
            id: 746,
            name: name("Nekkar_VIII_b"),
            name_key: "Nekkar_VIII_b",
            class: "pc_frozen",
            size: 6,
          },
        ],
      }),
    );

    const html = render(WORLD);
    expect(html).toContain("Moons · 2");
    const rows = html.match(/<div class="ins-prow"[^>]*role="button"/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(html).toContain("Nekkar VIII a");
    expect(html).toContain("Barren World");
    expect(html).toContain("Nekkar VIII b");
    expect(html.indexOf("About")).toBeLessThan(html.indexOf("Moons · 2"));
  });
});

describe("a save star body's page", () => {
  const armStar = () =>
    landPage(
      planetPage({
        id: STAR,
        name: name("Alpha"),
        name_key: "Alpha",
        class: "pc_a_star",
        size: 30,
        deposits: [{ id: 1024, kind: "d_energy_2", swap_type: null }],
      }),
    );

  it("opens with its star type and size to edit, then its deposits", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await armStar();
    usePlanetDataStore.setState({
      depositTypes: new Map([
        [
          "d_energy_2",
          depositTypeView("d_energy_2", {
            name: "+2",
            orbital: true,
            yields: [resourceAmount("energy", 2, "Energy Credits")],
          }),
        ],
      ]),
    });

    const html = render(STAR);
    expect(html).toContain('<span class="name">Alpha</span>');
    expect(html).toContain("#101");
    expect(html).toContain('<span class="edit-label">Star type</span>');
    expect(html).toContain('aria-label="Star type: Class A Star"');
    expect(html.match(PICKER)?.[0]).not.toContain("disabled");
    expect(html).toContain('<span class="edit-label">Size</span>');
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Size"[^>]*value="30"/);
    expect(html.indexOf("Star type")).toBeLessThan(html.indexOf("Deposits · 1"));
    expect(html.indexOf("Deposits · 1")).toBeLessThan(html.indexOf("About"));
    expect(html).toContain("Energy Credits");
    expect(html).toContain('title="Open the system&#x27;s page"');
    expect(html).toContain("editable · plain text is information");
  });

  it("waits, disabled, while an edit has left the system's details stale", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await armStar();

    useDetailsStore.getState().invalidate([SYSTEM]);
    const html = render(STAR);
    expect(html.match(PICKER)?.[0]).toContain("disabled");
    expect(html).toContain(READING_STARS.replace("'", "&#x27;"));
  });

  it("waits for its system's details before showing the star's fields", async () => {
    armStarClasses();
    await open("save");
    await armStar();

    const html = render(STAR);
    expect(html).toContain(READING_STARS.replace("'", "&#x27;"));
    expect(html).not.toContain("Star type");
    expect(html).not.toMatch(/<span class="k">(Class|Size)<\/span>/);
    expect(html).toContain("Deposits · 1");
  });

  it("says why the star type is disabled without game data", async () => {
    armStarClasses();
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    await land(stars());
    await armStar();

    const html = render(STAR);
    expect(html.match(PICKER)?.[0]).toContain("disabled");
    expect(html).toContain(STARS_NEED_GAME_DATA);
  });

  it("keeps the generic view on the Data tab", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await armStar();

    const html = render(STAR, "data");
    expect(html).toContain(GENERIC_HEAD);
    expect(html).not.toContain("Star type");
    expect(html).not.toContain("Deposits");
  });
});

describe("without game data", () => {
  it("lists deposit keys as text, with no art and no totals", async () => {
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    await landPage(
      planetPage({
        id: WORLD,
        deposits: [
          { id: 1, kind: "d_mineral_fields", swap_type: null },
          { id: 2, kind: "d_massive_glacier", swap_type: "d_crystalline_caverns" },
          { id: 3, kind: "d_mineral_fields", swap_type: null },
        ],
        planet_modifiers: ["pm_abundant_geothermal_activity"],
      }),
    );

    const html = render(WORLD);
    expect(html).toContain("Deposits · 3");
    expect(html).toContain('<span class="l1 mono">d_mineral_fields</span>');
    expect(html).toContain("×2");
    expect(html).toContain("Hides d_crystalline_caverns");
    expect(html).toContain('<span class="l1 mono">pm_abundant_geothermal_activity</span>');
    expect(html).not.toContain('class="pl-caps"');
    expect(html).not.toContain("pl-dep-art");
  });

  it("names an unnamed body alike in its system's list, on its page and where a moon orbits it", async () => {
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    const unnamed = { name: name(""), name_key: "", class: "pc_tropical" };
    await land(
      details({
        planets: [
          planet(WORLD, "", unnamed),
          planet(745, "Nekkar_a", { class: "pc_barren_cold", moon: true }),
        ],
      }),
    );
    await landPage(planetPage({ id: WORLD, ...unnamed }));
    await landPage(planetPage({ id: 745, class: "pc_barren_cold", parent: WORLD }));

    expect(overview()).toContain("Tropical World");
    expect(render(WORLD)).toContain('<span class="name">Tropical World</span>');
    expect(render(745)).toMatch(/Orbits<\/span>.*?Tropical World/);
  });
});

describe("a planet with no page of its own", () => {
  it("is the generic view on a scenario", async () => {
    armStarClasses();
    await open("scenario");
    await land(stars());
    await armStar();

    const html = render(STAR);
    expect(html).toContain(GENERIC_HEAD);
    expect(html).not.toContain("Star type");
    expect(html).not.toContain("Deposits");
  });

  function armStar(): Promise<void> {
    return landPage(
      planetPage({
        id: STAR,
        class: "pc_a_star",
        deposits: [{ id: 1, kind: "d_energy_2", swap_type: null }],
      }),
    );
  }

  it("is the generic view when the save cannot answer for the planet", async () => {
    await open("save");
    vi.mocked(ipc.getPlanetPage).mockRejectedValueOnce(new Error("planet #100 not found"));
    useEntityStore.getState().requestPlanetPage(WORLD);
    await vi.waitFor(() =>
      expect(useEntityStore.getState().errors.has(planetPageKey(WORLD))).toBe(true),
    );

    const html = render(WORLD);
    expect(html).not.toContain("Deposits");
    expect(html).toContain(GENERIC_HEAD);
  });
});
