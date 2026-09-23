import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import type { OpenResult } from "../../generated/OpenResult";
import { name, OPEN_RESULT, SCENARIO_OWNERS, SCENARIO_RESULT } from "../../store/fixture";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
// The row emblems come from the map's texture cache, which no test renderer can fill.
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { bindStores } from "../../store/bindStores";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { Empires, MAP_COLORS_NEED_4_5, MapColorStrip } from "./Empires";

const mocked = {
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
};

bindStores();

beforeEach(() => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState(), status: "ready" });
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
});

/** Opens the scenario and stamps its territories the way `refreshScenarioOwners` does. */
async function openScenarioWithOwners(): Promise<void> {
  await useFileSessionStore.getState().openScenarioFrom(SCENARIO_RESULT.path);
  useGameDataStore.setState({ scenarioOwners: SCENARIO_OWNERS });
  useGalaxyStore.getState().setScriptedOwners(
    new Map(SCENARIO_OWNERS.owners.map((o) => [o.system, o.territory])),
    SCENARIO_OWNERS.territories.map((t) => t.country),
  );
}

const empires = () => renderToStaticMarkup(<Empires />);

describe("a scenario's territory rows", () => {
  it("badges the day-one territory but not the generation one", async () => {
    await openScenarioWithOwners();

    const html = empires();
    expect(html).toContain("Fixture Empire");
    expect(html).toContain("Fixture Day One Empire");
    // Two rows, and only the day-one one carries a badge of each kind.
    expect(html.match(/class="chip src" title="Claimed on day one/g)).toHaveLength(1);
    expect(html.match(/class="chip warn" title="A claim whose conditions/g)).toHaveLength(1);
    expect(html).toContain(">day 1<");
    expect(html).toContain(">assumed<");
  });

  it("marks where each territory comes from: the initializers, or the scripts on day one", async () => {
    await openScenarioWithOwners();

    const html = empires();
    expect(
      html.match(/class="chip init" title="These systems are claimed at generation/g),
    ).toHaveLength(1);
    expect(
      html.match(/class="chip src" title="These systems are claimed on day one/g),
    ).toHaveLength(1);
    expect(html).toContain(">initializers<");
    expect(html).toContain(">scripts<");
  });

  it("shows the day-one and assumed counts under the list", async () => {
    await openScenarioWithOwners();

    expect(empires()).toContain("1 claimed on day one · 1 assumed");
  });

  it("shows the rewritten legend copy", async () => {
    await openScenarioWithOwners();

    const html = empires();
    expect(html).toContain("Territories are the systems the scripts hand out");
    expect(html).toContain("marked assumed");
  });
});

/** One empire of the save's own, which the shared galaxy fixture has none of. */
const EMPIRE: CountryNode = {
  id: 7,
  name: name("NAME_Test_Empire"),
  name_key: "NAME_Test_Empire",
  country_type: "default",
  capital_system: 1,
  system_count: 2,
  colors: ["fixture_blue", "fixture_blue"],
  border_color: null,
  fill_color: null,
  flag_colors: [],
  use_map_color: false,
  flag_icon: null,
  flag_background: null,
};

const SAVE_WITH_EMPIRE: OpenResult & { path: string } = {
  ...OPEN_RESULT,
  galaxy: { ...OPEN_RESULT.galaxy, countries: [EMPIRE] },
};

describe("a save's empire rows", () => {
  it("carries no territory badge, since a save has no scripted tiers", async () => {
    mocked.openSave.mockResolvedValue(SAVE_WITH_EMPIRE);
    await useFileSessionStore.getState().openSave(SAVE_WITH_EMPIRE.path);

    const html = empires();
    expect(html).toContain("Test Empire");
    expect(html).not.toContain('class="chip src"');
    expect(html).not.toContain('class="chip warn"');
    expect(html).not.toContain('class="chip init"');
    expect(html).not.toContain(">day 1<");
    expect(html).not.toContain(">assumed<");
  });

  it("offers the map colour edit on each empire", async () => {
    mocked.openSave.mockResolvedValue(SAVE_WITH_EMPIRE);
    await useFileSessionStore.getState().openSave(SAVE_WITH_EMPIRE.path);

    expect(empires()).toContain('aria-label="Edit Test Empire&#x27;s map colours"');
  });
});

describe("an empire's map colour strip", () => {
  /** An empire of a 4.5 save with a map border and fill of its own. */
  const CHOSEN: CountryNode = {
    ...EMPIRE,
    flag_colors: ["red", "purple", "black", "grey", "intense_red", "light_pink"],
    use_map_color: true,
  };
  const PALETTE = [
    { name: "intense_red", map: "#e02020", flag: "#e02020", ship: "#e02020" },
    { name: "light_pink", map: "#f0b0c0", flag: "#f0b0c0", ship: "#f0b0c0" },
  ];
  const strip = (country: CountryNode) => renderToStaticMarkup(<MapColorStrip country={country} />);

  beforeEach(() => {
    useGameDataStore.setState({
      mapColors: new Map(PALETTE.map((c) => [c.name, c])),
      mapColorSource: null,
    });
  });

  it("shows the current border and fill with their swatches, and the game's palette", () => {
    const html = strip(CHOSEN);
    expect(html).toContain("Map colours");
    expect(html).toContain('aria-label="Border: intense_red"');
    expect(html).toContain('aria-label="Fill: light_pink"');
    expect(html).toContain("background:#e02020");
    expect(html).toContain("background:#f0b0c0");
    expect(html).toContain("Use flag colours instead");
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toContain("Palette: Stellaris");
    expect(html).not.toContain(MAP_COLORS_NEED_4_5);
  });

  it("ticks the flag colours box when map colours are off, and names a colour it cannot find", () => {
    const html = strip({
      ...CHOSEN,
      flag_colors: [...CHOSEN.flag_colors.slice(0, 4), "red", "purple"],
      use_map_color: false,
    });
    expect(html).toMatch(/<input[^>]*checked/);
    expect(html).toContain('aria-label="Border: unknown: red"');
  });

  it("asks for a 4.5 save when the empire has only its four flag colours", () => {
    const html = strip({ ...EMPIRE, flag_colors: ["red", "purple", "black", "grey"] });
    expect(html).toContain(MAP_COLORS_NEED_4_5);
    expect(html).not.toContain("Border");
  });

  it("names the mod the palette comes from, and that the save needs it", () => {
    useGameDataStore.setState({ mapColorSource: "More Colours" });

    const html = strip(CHOSEN);
    expect(html).toContain("Palette: More Colours");
    expect(html).toContain("The save needs this mod to show these colours.");
  });
});
