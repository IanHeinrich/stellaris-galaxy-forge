import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

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
  editResult,
  planetPage,
  resourceAmount,
  starClassView,
} from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry, type InspectorTab } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { TERRAFORMING_NOTE } from "../../../lib/details/depositWarnings";
import { useAnomalyPickerStore } from "../../../store/anomalyPickerStore";
import { useDepositPickerStore } from "../../../store/depositPickerStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { SAVE_CAPABILITIES } from "../../../lib/capabilities";
import { useDigSitePickerStore } from "../../../store/digSitePickerStore";
import { planetPickerTarget } from "../../../store/planetEditAdapter";
import { details, land, open, overview, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { READING_STARS } from "../system/StarClassLine";
import { PlanetView } from "./PlanetView";
import { PICKER_HEIGHT } from "./PickerMenu";
import {
  READING_TARGETS,
  SystemChoice,
  TARGETS_FAILED,
  type TargetsRead,
} from "./PlanetSystemField";
import type { PlanetMoveTargets } from "../../../generated/PlanetMoveTargets";
import { escaped as escapedText } from "../../../test/elements";
import { orbitClasses, orbitSystem, saveBody } from "../../../test/builders";
import { drawnBy, drawnButton, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { PickerField, TextField, ToggleField } from "../../EditField";
import { ComboField } from "../../ComboField";
import { useEditorStore } from "../../../store/editorStore";
import { STARS_NEED_GAME_DATA } from "../../../lib/details/starClass";
import { GEOMETRY_REASONS } from "../../../lib/details/orbitEdits";
import { MODEL_TITLE } from "../../../lib/details/planetModel";
import { CLASS_FIXED, CLASS_LOOK_NOTE } from "../../../lib/details/planetClass";

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
      districts: [{ kind: "district_mining", level: 2 }],
      zones: [],
      buildings: [],
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
    expect(html).toContain("Blockers · 0");
    expect(html).not.toContain(TERRAFORMING_NOTE);
  });

  it("says a terraforming colony's deposits change when it finishes", async () => {
    await open("save");
    await landPage({ ...COLONY, terraforming: true });
    armDeposits();

    expect(render(WORLD)).toContain(TERRAFORMING_NOTE);
  });

  it("offers its name, size and class to edit, then shows the owner, designation, date and pops", async () => {
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage(COLONY);
    armDeposits();

    const html = render(WORLD);
    expect(html).toContain('<span class="edit-label">Class</span>');
    expect(html).toContain("Tropical World");
    expect(html).not.toMatch(/<span class="k">Class<\/span>/);
    expect(html).not.toMatch(/<span class="k">Size<\/span>/);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Size"[^>]*value="16"/);
    expect(html).toContain("Within a month the game demolishes districts over a lowered cap.");
    expect(html.match(/class="edit-field [^"]*"/g)).toEqual([
      'class="edit-field edit-text"',
      'class="edit-field edit-text"',
      'class="edit-field edit-text combo-box disabled"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field dp-open"',
      'class="edit-field edit-key-sample"',
    ]);
    expect(html).toMatch(/<input type="text" aria-label="Name"/);
    expect(html).toContain("+ Add modifier…");
    expect(html).toContain("+ Add dig site…");
    expect(html).toContain("Add deposit");
    expect(html).toContain("+ Add anomaly…");
    expect(html.match(/pl-dep-remove/g)).toHaveLength(3);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnBy(() => render(WORLD));
    const nameField = drawnField(TextField, "Name") as { onCommit(v: string): void };
    nameField.onCommit(" Nova Terra ");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "RenameBody",
        body: WORLD,
        name: { Literal: "Nova Terra" },
      }),
    );
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
    expect(html).toContain("Reading the system…");
    expect(html).not.toContain("radius 60");
    expect(html).not.toContain("Controller");
    expect(html.indexOf("Deposits")).toBeLessThan(html.indexOf("Colonised"));
    expect(html.indexOf("Colonised")).toBeLessThan(html.indexOf("About"));
  });
});

describe("a colony's removal and a planet's deletion", () => {
  const COLONY = planetPage({
    id: WORLD,
    class: "pc_tropical",
    owner: EMPIRE,
    controller: EMPIRE,
    colony: {
      id: 29,
      colonised: "2200.01.01",
      final_designation: null,
      designation: null,
      pops: 1600,
      species: [],
      districts: [],
      zones: [],
      buildings: [],
    },
  });

  it("offers Remove colony in the colony's section and Delete planet below the moons, apart", async () => {
    await open("save");
    await landPage(COLONY);

    const html = render(WORLD);
    expect(html).toContain(">Remove colony</button>");
    expect(html).toContain(">Delete planet</button>");
    expect(html.indexOf("Remove colony")).toBeLessThan(html.indexOf("About"));
    expect(html.indexOf("About")).toBeLessThan(html.indexOf("Delete planet"));
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({ type: "RemoveColony", body: WORLD });
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({ type: "DeleteBody", body: WORLD });
  });

  it("shows why the core refuses, and disables the action", async () => {
    await open("save");
    await landPage(COLONY);
    const refusal =
      "the colony on planet 100 cannot be removed: a megastructure stands on or around it, which has not been tried in game";
    mockedIpc.checkOp.mockImplementation(async (op) =>
      op.type === "RemoveColony" ? refusal : null,
    );
    render(WORLD);
    await vi.waitFor(() => expect(render(WORLD)).toContain(refusal));

    const html = render(WORLD);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove colony<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete planet<\/button>/);
  });

  it("offers neither on a save's star", async () => {
    await open("save");
    await landPage({ ...planetPage({ id: WORLD }), class: "pc_g_star" });
    useGameDataStore.setState({
      starClasses: new Map([starClassView("sc_g", "pc_g_star")].map((v) => [v.key, v])),
    });
    const html = render(WORLD);
    expect(html).not.toContain("Delete planet");
    expect(html).not.toContain("Remove colony");
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

  it("offers its size, a remove button per deposit type and a picker to add one", async () => {
    await open("save");
    await landPage(OLBERS);

    const html = drawnBy(() => render(WORLD));
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Size"[^>]*value="16"/);
    expect(html.match(/class="pl-dep-remove"/g)).toHaveLength(3);
    expect(html).toContain("+ Add deposit…");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove d_active_volcano").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({ type: "RemoveDeposit", deposit: 3 }),
    );
  });

  it("offers a remove button per modifier, taking a feature's line with it, and a picker to add one", async () => {
    await open("save");
    await landPage(OLBERS);

    const html = drawnBy(() => render(WORLD));
    expect(html.match(/class="pl-dep-remove pl-mod-remove"/g)).toHaveLength(1);
    expect(html).toContain("+ Add modifier…");
    expect(html).not.toContain("Terraforming candidate");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove pm_abundant_geothermal_activity").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "RemoveBodyModifier",
        body: WORLD,
        modifier: "abundant_geothermal_activity",
        feature: "pm_abundant_geothermal_activity",
      }),
    );
  });

  it("opens the picker below the deposits: search, chips, and a row per family with its amounts", async () => {
    await open("save");
    await landPage(OLBERS);
    usePlanetDataStore.setState({
      depositTypes: new Map(
        [1, 3].map((n) => [
          `d_energy_${n}`,
          depositTypeView(`d_energy_${n}`, {
            name: `+${n}`,
            orbital: true,
            yields: [resourceAmount("energy", n, "Energy")],
          }),
        ]),
      ),
    });
    useDepositPickerStore.setState({
      target: planetPickerTarget(OLBERS, false),
      added: "Added +1 Energy",
      choices: {
        body: "",
        list: [
          {
            key: "d_energy_1",
            family: "d_energy",
            amount: 1,
            category: "Energy",
            usual: true,
            description: null,
            event_only: false,
          },
          {
            key: "d_energy_3",
            family: "d_energy",
            amount: 3,
            category: "Energy",
            usual: true,
            description: null,
            event_only: false,
          },
        ],
      },
    });

    const html = drawnBy(() => render(WORLD));
    expect(html).toContain('aria-label="Search deposits"');
    expect(html).toContain('aria-pressed="true">All</button>');
    expect(html).toContain("Usual here");
    expect(html).toContain("✓ Added +1 Energy");
    expect(html).toContain("Usual for this planet · 1");
    expect(html).toContain("Energy per month");
    expect(html).toContain(
      '<span class="dp-details-name">Energy</span><span class="muted">No description</span>',
    );
    expect(html).not.toContain("+ Add deposit…");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Add +3 Energy").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "AddDeposit",
        body: WORLD,
        kind: "d_energy_3",
      }),
    );
  });

  it("puts Add deposit under the deposits and Add blocker under the blockers, even with none", async () => {
    await open("save");
    await landPage(
      planetPage({ id: WORLD, deposits: [{ id: 1, kind: "d_open_plains", swap_type: null }] }),
    );

    const html = render(WORLD);
    expect(html.indexOf("d_open_plains")).toBeLessThan(html.indexOf("+ Add deposit…"));
    expect(html.indexOf("+ Add deposit…")).toBeLessThan(html.indexOf("Blockers · 0"));
    expect(html.indexOf("Blockers · 0")).toBeLessThan(html.indexOf("+ Add blocker…"));

    useDepositPickerStore.setState({
      target: planetPickerTarget(planetPage({ id: WORLD }), false),
      mode: "blockers",
      choices: { body: "", list: [] },
    });
    const open_ = render(WORLD);
    expect(open_).toContain('aria-label="Search blockers"');
    expect(open_).not.toContain("Deposit categories");
    expect(open_).toContain("+ Add deposit…");
  });

  it("names the anomaly waiting on it and who found it where it cannot be edited", async () => {
    await open("save");
    useFileSessionStore.setState({ capabilities: { ...SAVE_CAPABILITIES, deposits: false } });
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [EMPIRE] } });

    const html = render(WORLD);
    expect(html).toMatch(/<span class="k">Anomaly<\/span><span>time_loop_world/);
    expect(html).toContain("found by Ti Zru Conservers");
    expect(html).not.toContain("Remove time_loop_world");
  });

  const TIME_LOOP = {
    key: "time_loop_world",
    name: "Time Loop",
    level: 8,
    description: "The planet repeats the same day.",
    usual: false,
  };

  it("draws an editable anomaly once, in its section, with who found it and the game's description", async () => {
    useGameDataStore.setState({ status: "ready" });
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [EMPIRE] } });
    useAnomalyPickerStore.setState({ choices: { body: "", list: [TIME_LOOP] } });

    const html = render(WORLD);
    expect(html).not.toMatch(/<span class="k">Anomaly<\/span>/);
    expect(html.match(/found by Ti Zru Conservers/g)).toHaveLength(1);
    expect(html).toContain('<span class="pl-anomaly-desc">The planet repeats the same day.</span>');
    expect(html.indexOf("Remove time_loop_world")).toBeLessThan(html.indexOf("About"));
  });

  it("shows no description without game data", async () => {
    useGameDataStore.setState({ status: "idle" });
    await open("save");
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [] } });
    useAnomalyPickerStore.setState({ choices: { body: "", list: [TIME_LOOP] } });

    const html = render(WORLD);
    expect(html).toContain("not found yet");
    expect(html).not.toContain("pl-anomaly-desc");
  });

  it("offers a remove button on its anomaly, and no picker while it has one", async () => {
    await open("save");
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [] } });

    const html = drawnBy(() => render(WORLD));
    expect(html).toContain("Anomaly");
    expect(html).toContain("not found yet");
    expect(html).not.toContain("+ Add anomaly…");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove time_loop_world").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({ type: "RemoveAnomaly", body: WORLD }),
    );
  });

  it("offers a picker to add an anomaly when it has none", async () => {
    await open("save");
    await landPage(OLBERS);

    const html = render(WORLD);
    expect(html).toContain("+ Add anomaly…");
    expect(html.indexOf("+ Add modifier…")).toBeLessThan(html.indexOf("+ Add anomaly…"));
    expect(html.indexOf("+ Add anomaly…")).toBeLessThan(html.indexOf("About"));
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

  const SITE_TYPES = [
    {
      key: "site_lost_moments",
      name: "Never Forget",
      description: "Records of a people who chose to remember.",
      difficulty: 1,
      stages: 3,
      rolled: true,
      offered: true,
    },
    {
      key: "site_repowered_complex",
      name: "Repowered Complex",
      description: "A complex that has come back to life.",
      difficulty: 2,
      stages: 1,
      rolled: false,
      offered: true,
    },
  ];

  it("shows its dig site's stage, clues and description, with a button to remove it", async () => {
    await open("save");
    await landPage({
      ...OLBERS,
      dig_site: {
        id: 7,
        kind: "site_lost_moments",
        stages_done: 1,
        clues: 5,
        excavating: true,
      },
    });
    useGameDataStore.setState({ names: new Map([["site_lost_moments", "Never Forget"]]) });
    useDigSitePickerStore.setState({ choices: { body: "", list: SITE_TYPES } });

    const html = drawnBy(() => render(WORLD));
    expect(html).toContain("Dig site");
    expect(html).toContain("Never Forget");
    expect(html).toContain("Stage 2 of 3 · 5 clues · Excavating");
    expect(html).toContain('<span class="l3">Records of a people who chose to remember.</span>');
    expect(html).not.toContain("+ Add dig site…");
    expect(html.indexOf("Modifiers · 1")).toBeLessThan(html.indexOf("Dig site"));

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove Never Forget").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({ type: "RemoveDigSite", site: 7 }),
    );
  });

  it("counts the stages of a site type the picker leaves out", async () => {
    await open("save");
    await landPage({
      ...OLBERS,
      dig_site: { id: 2, kind: "site_the_library", stages_done: 3, clues: 0, excavating: false },
    });
    useDigSitePickerStore.setState({
      choices: {
        body: "",
        list: [
          ...SITE_TYPES,
          {
            key: "site_the_library",
            name: "The Library",
            description: null,
            difficulty: 4,
            stages: 3,
            rolled: true,
            offered: false,
          },
        ],
      },
    });

    const html = render(WORLD);
    expect(html).toContain("Finished · 0 clues");
    expect(html).not.toContain('class="l3"');
  });

  it("describes nothing of its dig site without the game data", async () => {
    await open("save");
    await landPage({
      ...OLBERS,
      dig_site: { id: 7, kind: "site_lost_moments", stages_done: 0, clues: 0, excavating: false },
    });

    const html = render(WORLD);
    expect(html).toContain("Stage 1 · 0 clues");
    expect(html).not.toContain('class="l3"');
  });

  it("offers Add dig site without one, and the open picker filters by how a site is found", async () => {
    await open("save");
    await landPage(OLBERS);
    expect(render(WORLD)).toContain("+ Add dig site…");

    useDigSitePickerStore.setState({
      target: planetPickerTarget(OLBERS, false),
      choices: { body: "", list: SITE_TYPES },
      chip: "Events",
    });
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain('aria-label="Search dig sites"');
    expect(html).toContain(`<div class="dp" style="height:${PICKER_HEIGHT}px"`);
    expect(html).toContain("Found by surveys");
    expect(html).toContain('aria-pressed="true">Event only</button>');
    expect(html).toContain("Repowered Complex");
    expect(html).toContain("1 stage · event only");
    expect(html).not.toContain("Never Forget");
    expect(html).toMatch(
      /<div id="(ds-row-[^"]+-details)" class="dp-details"><span class="dp-details-name">Repowered Complex<\/span><span class="dp-details-text">A complex that has come back to life.<\/span><\/div>/,
    );
    expect(html).toMatch(
      /id="ds-row-[^"]+-0" class="dp-row active" aria-describedby="ds-row-[^"]+-details"/,
    );

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Add Repowered Complex").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "AddDigSite",
        body: WORLD,
        site_type: "site_repowered_complex",
        difficulty: 2,
      }),
    );

    useDigSitePickerStore.setState({
      target: planetPickerTarget(OLBERS, false),
      query: "no such site",
    });
    const none = render(WORLD);
    expect(none).toContain("No dig site matches");
    expect(none).toMatch(/class="dp-details"><\/div>/);
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
    expect(html).toContain("+ Add anomaly…");
    expect(html).toContain('title="Open the system&#x27;s page"');
    expect(html).toContain("editable · plain text is information");
    expect(html).not.toContain("Dig site");
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

describe("a body's orbit", () => {
  const PLANET = 2;
  const MOON = 3;
  const LONE = 5;

  /** The orbit fixture's system as system `SYSTEM`, its ringed planet named Sol III. */
  async function landOrbits(): Promise<void> {
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    read.planets = read.planets.map((p) =>
      p.id === PLANET ? { ...p, name: name("Sol_III"), name_key: "Sol_III" } : p,
    );
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
  }

  const bodyPage = (id: number, over: Partial<PlanetPage> = {}) =>
    landPage(planetPage({ id, class: "pc_arid", ...over }));

  it("opens with what the body orbits, its radius and its angle to edit, read from the layout", async () => {
    await open("save");
    await landOrbits();
    await bodyPage(LONE, { orbit: 999 });

    const html = drawnBy(() => render(LONE));
    expect(html).toContain('aria-label="Orbit"');
    expect(html).toContain('aria-label="Orbits: The star"');
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Orbit radius"[^>]*value="100"/);
    expect(html).toMatch(/<input type="number"[^>]*aria-label="Angle"[^>]*value="120"/);
    expect(html).not.toContain("999");
    expect(html).not.toContain("Measured from");
    expect(html).toContain("editable · plain text is information");
    expect(html.indexOf("Orbit radius")).toBeLessThan(html.indexOf("About"));

    const orbits = drawnField(PickerField, "Orbits");
    expect(orbits.items.map((item) => item.label)).toEqual(["The star", "Sol III"]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    orbits.onPick(String(PLANET));
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetBodyParent",
          body: LONE,
          parent: { Body: PLANET },
          radius: 25,
        }),
      ),
    );
  });

  it("says a moon's orbit is measured from its planet, and offers no picker to a planet with moons", async () => {
    await open("save");
    await landOrbits();
    await bodyPage(MOON, { parent: PLANET });
    await bodyPage(PLANET);

    const moon = render(MOON);
    expect(moon).toContain("Measured from Sol III");
    expect(moon).toContain('aria-label="Orbits: Sol III"');
    expect(moon).toMatch(/aria-label="Orbit radius"[^>]*value="15"/);
    expect(moon).toMatch(/Orbits<\/span>.*?Sol III/);

    const planet = render(PLANET);
    expect(planet).toMatch(/aria-label="Orbit radius"[^>]*value="60"/);
    expect(planet).not.toContain('aria-label="Orbits:');
  });

  it("offers a planet with moons the companion star, and a planet named to the centre's star the star", async () => {
    await open("save");
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    const companion = saveBody(8, "pc_g_star", [-240, 0], 240, 20);
    read.planets.push({ ...companion, name: name("Sol_B"), name_key: "Sol_B" });
    read.planets.push(saveBody(9, "pc_arid", [0, -140], 140, 10, 1));
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
    await bodyPage(9, { parent: 1 });
    expect(render(9)).toContain('aria-label="Orbits: The star"');

    await bodyPage(PLANET);
    render(PLANET);
    const orbits = drawnField(PickerField, "Orbits");
    expect(orbits.items.map((item) => item.label)).toEqual(["The star", "Sol B"]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    orbits.onPick("8");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetBodyParent",
          body: PLANET,
          parent: { Body: 8 },
          radius: 30,
        }),
      ),
    );
  });

  it("offers a moon whose planet is missing only the star, detaching it where it stands", async () => {
    await open("save");
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    read.planets.push(saveBody(58, "pc_barren", [100, 20], 10, 6, 57));
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
    await bodyPage(58, { parent: 57 });

    const html = drawnBy(() => render(58));
    expect(html).toContain('aria-label="Orbits: #57"');
    expect(html).not.toContain("Orbit radius");
    expect(html).toContain(GEOMETRY_REASONS.noOrbit);
    const orbits = drawnField(PickerField, "Orbits");
    expect(orbits.items.map((item) => item.label)).toEqual(["The star"]);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    orbits.onPick("star");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetBodyParent",
          body: 58,
          parent: "Centre",
          radius: expect.closeTo(Math.hypot(100, 20), 6),
          angle: expect.closeTo((Math.atan2(20, 100) * 180) / Math.PI, 6),
        }),
      ),
    );
  });

  it("reads the system first, and shows no orbit fields on a scenario", async () => {
    await open("save");
    await bodyPage(LONE);
    expect(render(LONE)).toContain("Reading the system…");

    await open("scenario");
    await landOrbits();
    const html = render(LONE);
    expect(html).not.toContain("Orbit radius");
    expect(html).not.toContain("Reading the system…");
  });
});

describe("a body's ring", () => {
  const STAR_BODY = 1;
  const PLANET = 2;
  const MOON = 3;
  const ASTEROID = 6;
  const RING = /<input type="checkbox"( checked="")?\/>Ring<\/label>/;

  /** The orbit fixture's system as system `SYSTEM`, its planet with a ring. */
  async function landRinged(): Promise<void> {
    const read = orbitSystem({ id: SYSTEM, with_game_data: true });
    read.planets = read.planets.map((p) => (p.id === PLANET ? { ...p, ring: true } : p));
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    await land(read);
  }

  const bodyPage = (id: number, over: Partial<PlanetPage> = {}) =>
    landPage(planetPage({ id, class: "pc_arid", ...over }));

  it("shows a planet's ring checked and a moon's unchecked, and a tick sends the ring", async () => {
    await open("save");
    await landRinged();
    await bodyPage(MOON, { class: "pc_barren", parent: PLANET });
    await bodyPage(PLANET, { class: "pc_continental" });

    expect(render(MOON).match(RING)?.[1]).toBeUndefined();
    const html = drawnBy(() => render(PLANET));
    expect(html).toContain('aria-label="Planet"');
    expect(html.match(RING)?.[1]).toBe(' checked=""');

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnField(ToggleField, "Ring").onChange(false);
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyRing",
        body: PLANET,
        ring: false,
      }),
    );
  });

  it("offers no ring to a star or an asteroid", async () => {
    await open("save");
    await landRinged();
    await bodyPage(STAR_BODY, { class: "pc_g_star" });
    await bodyPage(ASTEROID, { class: "pc_asteroid" });

    for (const id of [STAR_BODY, ASTEROID]) {
      const html = render(id);
      expect(html).toContain("About");
      expect(html).not.toMatch(RING);
    }
  });

  it("offers no ring on a scenario", async () => {
    await open("scenario");
    await landRinged();
    await bodyPage(PLANET, { class: "pc_continental" });

    expect(render(PLANET)).not.toMatch(RING);
  });
});

describe("a planet's model", () => {
  const MODELS = [
    { entity: "ocean_paradise_planet_01_entity", label: "Ocean Paradise", classes: ["pc_ocean"] },
    { entity: "arctic_planet_earth_entity", label: "Earth", classes: ["pc_arctic"] },
  ];
  const MODEL = '<span class="edit-label">Model</span>';

  async function arm(over: Partial<PlanetPage> = {}): Promise<void> {
    await open("save");
    useGameDataStore.setState({
      planetModels: MODELS,
      names: new Map([["pc_arctic", "Arctic World"]]),
    });
    await landPage(planetPage({ id: WORLD, class: "pc_arctic", ...over }));
  }

  it("offers Default, then the class's usual models, then the others, and a pick sends it", async () => {
    await arm();
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain(MODEL);
    expect(html).toContain(escapedText(MODEL_TITLE));
    const field = drawnField(PickerField, "Model");
    expect(field.current.label).toBe("Default");
    expect(field.items.map((item) => [item.label, item.group])).toEqual([
      ["Default", undefined],
      ["Earth", "Usual for Arctic World"],
      ["Ocean Paradise", "Other models"],
    ]);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    field.onPick("ocean_paradise_planet_01_entity");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyModel",
        body: WORLD,
        entity: "ocean_paradise_planet_01_entity",
      }),
    );
  });

  it("shows the model a planet has, and Default takes it off", async () => {
    await arm({ entity_name: "ocean_paradise_planet_01_entity" });
    drawnBy(() => render(WORLD));
    const field = drawnField(PickerField, "Model");
    expect(field.current.label).toBe("Ocean Paradise");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    field.onPick("");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyModel",
        body: WORLD,
        entity: null,
      }),
    );
  });

  it("offers no model to a star or on a scenario", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await landPage(planetPage({ id: STAR, class: "pc_a_star", size: 30 }));
    expect(render(STAR)).toContain("Star type");
    expect(render(STAR)).not.toContain(MODEL);

    await open("scenario");
    await landPage(planetPage({ id: WORLD, class: "pc_arctic" }));
    expect(render(WORLD)).not.toContain(MODEL);
  });
});

describe("a planet's class", () => {
  const CLASS = '<span class="edit-label">Class</span>';

  async function arm(over: Partial<PlanetPage> = {}): Promise<void> {
    await open("save");
    useGameDataStore.setState({
      names: new Map([
        ["pc_arctic", "Arctic World"],
        ["pc_ocean", "Ocean World"],
        ["pc_barren", "Barren World"],
      ]),
      planetClasses: new Map(
        [
          planetClassView("pc_arctic", false, null, { change: "any", models: 3 }),
          planetClassView("pc_ocean", false, null, { change: "any", models: 3 }),
          planetClassView("pc_barren", false, null, { habitable: false, models: 3 }),
          planetClassView("pc_habitat", false, null, { change: "never" }),
        ].map((c) => [c.key, c]),
      ),
    });
    await landPage(planetPage({ id: WORLD, class: "pc_arctic", ...over }));
  }

  it("offers the classes the planet may take, says the look resets, and a pick sends it", async () => {
    await arm();
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain(CLASS);
    expect(html).toContain(escapedText(CLASS_LOOK_NOTE));
    expect(html).not.toContain('<span class="k">Class</span>');
    const field = drawnField(PickerField, "Class");
    expect(field.current.label).toBe("Arctic World");
    expect(field.items.map((item) => [item.label, item.group])).toEqual([
      ["Ocean World", "Habitable"],
      ["Barren World", "Other"],
    ]);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    field.onPick("pc_barren");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyClass",
        body: WORLD,
        from: { class: "pc_arctic", change: "any", models: 3 },
        to: { class: "pc_barren", change: "uncolonised", models: 3 },
      }),
    );
  });

  it("offers a colony only the classes open to colonies", async () => {
    const colony = {
      id: 29,
      colonised: "2200.01.01",
      final_designation: null,
      designation: null,
      pops: 100,
      species: [],
      districts: [],
      zones: [],
      buildings: [],
    };
    await arm({ owner: EMPIRE, controller: EMPIRE, colony });
    drawnBy(() => render(WORLD));
    const field = drawnField(PickerField, "Class");
    expect(field.items.map((item) => item.key)).toEqual(["pc_ocean"]);
  });

  it("keeps a habitat's class, and offers no class on a scenario", async () => {
    await arm({ class: "pc_habitat" });
    drawnBy(() => render(WORLD));
    const field = drawnField(PickerField, "Class");
    expect(field.items).toEqual([]);
    expect(render(WORLD)).toContain(escapedText(CLASS_FIXED));
    expect(render(WORLD)).not.toContain(escapedText(CLASS_LOOK_NOTE));

    await open("scenario");
    await landPage(planetPage({ id: WORLD, class: "pc_arctic" }));
    expect(render(WORLD)).not.toContain(CLASS);
  });
});

describe("the System field", () => {
  const targets = (over: Partial<PlanetMoveTargets> = {}): PlanetMoveTargets => ({
    planets: [WORLD],
    refused: [],
    systems: [
      { system: 3, warnings: [] },
      { system: 0, warnings: [] },
    ],
    ...over,
  });
  const field = (read: TargetsRead | null) =>
    renderToStaticMarkup(<SystemChoice id={WORLD} system={SYSTEM} read={read} />);

  it("shows the planet's system, and waits for where it can move", async () => {
    await open("save");
    expect(field(null)).toContain(`title="${READING_TARGETS}"`);
    const html = field({ targets: targets() });
    expect(html).toContain('value="Alpha Centauri"');
    expect(html).not.toContain("disabled");
  });

  it("keeps the picked system's warning under the field until the next edit", async () => {
    await open("save");
    const warning = { planet: WORLD, kind: "station", owner: 1, new_owner: EMPIRE } as const;
    const read = { targets: targets({ systems: [{ system: 3, warnings: [warning] }] }) };
    mockedIpc.planetMoveOp.mockResolvedValue({ type: "Batch", description: "Moved", ops: [] });
    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnBy(() => field(read));
    drawnField(ComboField, "System").onPick("3");
    await vi.waitFor(() => expect(field(read)).toContain("station will change ownership to"));

    mockedIpc.applyOp.mockResolvedValue(editResult({ history: { undo: [], redo: [] } }));
    await useEditorStore.getState().applyOp({ type: "MoveSystem", system: 3, x: 1, y: 1 });
    expect(field(read)).not.toContain("station will change ownership to");
  });

  it("says so when the core could not say where the planet can move", async () => {
    await open("save");
    const html = field({ failed: true });
    expect(html).toContain("disabled");
    expect(html).toContain(escapedText(TARGETS_FAILED));
  });

  it("is disabled with the core's refusal for a planet that cannot move", async () => {
    await open("save");
    const reason = "Nekkar I has an arc furnace: planets with a megastructure can't move";
    const html = field({ targets: targets({ refused: [{ planet: WORLD, reason }], systems: [] }) });
    expect(html).toContain("disabled");
    expect(html).toContain(escapedText(reason));
  });
});
