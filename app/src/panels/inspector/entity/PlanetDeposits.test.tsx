import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useEntityStore, viewKey } from "../../../store/entityStore";
import {
  depositTypeView,
  entityView,
  editResult,
  planetPage,
  resourceAmount,
} from "../../../store/fixture";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { TERRAFORMING_NOTE } from "../../../lib/details/depositWarnings";
import { useDepositPickerStore } from "../../../store/depositPickerStore";
import { open, resetStores } from "../inspectorFixture";
import { drawnBy, drawnButton } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import {
  WORLD,
  pickerTarget,
  landPage,
  render,
  districts,
  OLBERS,
  NEKKAR_COLONY,
  armColonyData,
} from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a colony's deposits", () => {
  it("groups its deposits by type, rare first, under the district caps they add up to", async () => {
    await open("save");
    await landPage(NEKKAR_COLONY);
    armColonyData();

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
    await landPage({ ...NEKKAR_COLONY, terraforming: true });
    armColonyData();

    expect(render(WORLD)).toContain(TERRAFORMING_NOTE);
  });
});

describe("an unowned world's deposits", () => {
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
      target: pickerTarget(OLBERS),
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
      target: pickerTarget(planetPage({ id: WORLD })),
      mode: "blockers",
      choices: { body: "", list: [] },
    });
    const open_ = render(WORLD);
    expect(open_).toContain('aria-label="Search blockers"');
    expect(open_).not.toContain("Deposit categories");
    expect(open_).toContain("+ Add deposit…");
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
});

describe("a gas giant's deposits", () => {
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
});

describe("deposits without game data", () => {
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
});
