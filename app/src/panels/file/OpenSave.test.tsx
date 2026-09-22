import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignListing } from "../../generated/CampaignListing";
import type { GalaxySettings } from "../../generated/GalaxySettings";
import type { SaveFile } from "../../generated/SaveFile";
import type { ScenarioListing } from "../../generated/ScenarioListing";
import { gameDataSummary, paintModView, saveMeta, scenarioSummary } from "../../test/builders";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("../useTextureUrl", () => ({ useTextureUrl: vi.fn(() => undefined) }));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import { usePaintModStore } from "../../store/paintModStore";
import {
  NEVER_WARN,
  NEVER_WARN_WHY,
  OPEN_NOT_FOR_PAINT,
  OPEN_PAINT_MOD_OFF,
  PAINT_CHECK,
  PAINT_MOD_NOT_ENABLED,
  PAINT_MOD_OFF_BREAKS,
  PAINT_UNTICKED,
  SCENARIO_FOR_PAINT,
  SCENARIO_PLAIN,
} from "../../lib/paintCopy";
import { footerOpens, type CampaignRow, type SaveRow, type ScenarioRow } from "../../lib/openRows";
import { detailsKey, useOpenScreenStore } from "../../store/openScreenStore";
import { useRecentsStore, type RecentDoc } from "../../store/recentsStore";
import { useTextureUrl } from "../useTextureUrl";
import { EmpireMark, OpenDetails } from "./OpenDetails";
import { OpenAsScenarioDialog } from "./OpenAsScenarioDialog";
import { OpenScenarioDialog } from "./OpenScenarioDialog";
import { OpenSave, RowBody } from "./OpenSave";
import { openRoute } from "./openRoute";

const DIR = "C:/saves/terran";

function saveFile(over: Partial<SaveFile> = {}): SaveFile {
  return {
    path: `${DIR}/2206.11.16.sav`,
    campaign: "terran_1",
    file_name: "2206.11.16.sav",
    meta: saveMeta({ name: "Terran Federation", planets: 1, fleets: 7 }),
    modified: 200,
    size: 4096,
    cloud: false,
    ...over,
  };
}

function saveRow(over: Partial<SaveRow> = {}): SaveRow {
  return {
    kind: "save",
    key: "save:1",
    file: saveFile(),
    empire: "Terran Federation",
    title: "2206.11.16",
    autosave: false,
    ...over,
  };
}

function scenarioListing(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return {
    path: "C:/mods/a/map/setup_scenarios/a.txt",
    name: "a_galaxy",
    systems: 100,
    source: "install",
    mod_name: null,
    enabled: true,
    shadowed_by: null,
    modified: 10,
    size: 1024,
    error: null,
    summary: scenarioSummary(),
    painted: false,
    ...over,
  };
}

function scenarioRow(over: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    kind: "scenario",
    key: "scenario:1",
    listing: scenarioListing(),
    group: "Install",
    subtitle: "100 systems · Stellaris",
    disabled: false,
    ...over,
  };
}

const CAMPAIGN: CampaignListing = {
  dir: DIR,
  name: "terran_1",
  empire: "Terran Federation",
  files: 3,
  newest: 200,
  meta: saveMeta({ name: "Terran Federation", date: "2206.11.16" }),
  cloud: false,
};

function campaignRow(): CampaignRow {
  return {
    kind: "campaign",
    key: `campaign:${DIR}`,
    campaign: CAMPAIGN,
    empire: "Terran Federation",
    subtitle: "v4.4.6 · 2206.11.16",
    count: "3 saves",
    expanded: true,
    loading: false,
    error: null,
  };
}

const SETTINGS: GalaxySettings = {
  template: "medium",
  shape: "spiral_3",
  num_empires: 9,
  num_advanced_empires: 2,
  num_fallen_empires: 2,
  num_marauder_empires: 2,
  num_nomad_empires: 2,
  habitability: 0.25,
  primitive: 0.25,
  resource_abundance: 2,
  num_gateways: 1,
  num_wormhole_pairs: 1,
  num_hyperlanes: 1,
  difficulty: "commodore",
  scaling: "scaling_off",
  crisis_type: "all",
  crises: 1,
  mid_game_start: 150,
  end_game_start: 225,
  ironman: false,
  core_radius: 120,
};

const noop = () => undefined;

/** The text a reader sees: no markup, no attributes, one space between words. */
function shown(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The label of every button, in order. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => shown(m[1]));
}

beforeEach(() => {
  vi.mocked(useTextureUrl).mockReset();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState(), status: "ready" });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
  useRecentsStore.setState({ recents: [] });
  useOpenScreenStore.setState({ ...useOpenScreenStore.getInitialState() });
});

describe("a row", () => {
  it("titles a save with its date, tags an autosave, and carries no button of its own", () => {
    const html = renderToStaticMarkup(
      <RowBody row={saveRow({ title: "2207.01.01", autosave: true })} onForget={noop} />,
    );
    expect(shown(html)).toMatch(/^2207\.01\.01 autosave /);
    expect(buttons(html)).toEqual([]);
  });

  it("gives a scenario its systems and mod, and no scenario action", () => {
    const html = renderToStaticMarkup(<RowBody row={scenarioRow()} onForget={noop} />);
    expect(shown(html)).toContain("a_galaxy Plain 100 systems · Stellaris");
    expect(buttons(html)).toEqual([]);
  });
});

describe("opening a save as a scenario", () => {
  const UNTICKED = PAINT_UNTICKED.split(":")[0];
  const dialog = () =>
    renderToStaticMarkup(
      <OpenAsScenarioDialog path={saveFile().path} onContinue={() => {}} onCancel={() => {}} />,
    );

  it("asks the Paint a Galaxy question, with the warning while it is unticked", () => {
    usePaintModStore.setState({ paintChoice: false });
    expect(shown(dialog())).toContain(PAINT_CHECK);
    expect(shown(dialog())).toContain(UNTICKED);
    expect(buttons(dialog())).toEqual(["Cancel", "Continue"]);

    usePaintModStore.setState({ paintChoice: true });
    expect(shown(dialog())).not.toContain(UNTICKED);
  });
});

describe("opening a scenario file", () => {
  const UNTICKED = PAINT_UNTICKED.split(":")[0];
  const dialog = () => renderToStaticMarkup(<OpenScenarioDialog />);
  const ask = (kind: "not_for_paint" | "paint_mod_off") =>
    useFileSessionStore.setState({
      scenarioPrompt: { path: scenarioListing().path, kind, forPaint: false, resolve: noop },
    });

  beforeEach(() => {
    usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
  });

  it("shows nothing while no scenario is waiting", () => {
    expect(dialog()).toBe("");
  });

  it("asks about a scenario that isn't for Paint a Galaxy, with the warning and a way to stop asking", () => {
    ask("not_for_paint");
    usePaintModStore.setState({ paintChoice: false });
    expect(shown(dialog())).toContain(OPEN_NOT_FOR_PAINT);
    expect(shown(dialog())).toContain(PAINT_CHECK);
    expect(shown(dialog())).toContain(UNTICKED);
    expect(shown(dialog())).toContain(NEVER_WARN);
    expect(shown(dialog())).toContain(NEVER_WARN_WHY.split(".")[0]);
    expect(buttons(dialog())).toEqual(["Cancel", "Continue"]);
  });

  it("warns that the mod a Paint a Galaxy scenario needs is off, and offers no way to stop warning", () => {
    ask("paint_mod_off");
    expect(shown(dialog())).toContain(OPEN_PAINT_MOD_OFF);
    expect(shown(dialog())).toContain(PAINT_MOD_NOT_ENABLED);
    expect(shown(dialog())).not.toContain(NEVER_WARN);
    expect(shown(dialog())).not.toContain(PAINT_CHECK);
  });

  it("leaves the Open as scenario question without a way to stop asking", () => {
    const html = renderToStaticMarkup(
      <OpenAsScenarioDialog path={saveFile().path} onContinue={noop} onCancel={noop} />,
    );
    expect(shown(html)).not.toContain(NEVER_WARN);
  });

  it("tags a scenario row PaG or Plain, with the full wording on hover", () => {
    const painted = renderToStaticMarkup(
      <RowBody
        row={scenarioRow({ listing: scenarioListing({ painted: true }) })}
        onForget={noop}
      />,
    );
    expect(painted).toContain(`title="${SCENARIO_FOR_PAINT.line}">PaG<`);
    const plain = renderToStaticMarkup(<RowBody row={scenarioRow()} onForget={noop} />);
    expect(plain).toContain(`title="${SCENARIO_PLAIN.line}">Plain<`);
  });

  it("tags a recent scenario only when the listing or the mod's folder can tell", () => {
    const recent = (path: string) =>
      renderToStaticMarkup(
        <RowBody
          row={{
            kind: "recent",
            key: `recent:${path}`,
            doc: { kind: "scenario", path, title: "mine", subtitle: "", openedAt: 5 },
            missing: false,
          }}
          onForget={noop}
        />,
      );
    usePaintModStore.setState({
      paintMod: paintModView({ scenarios_dir: "C:/mods/pag/map/setup_scenarios" }),
    });
    expect(shown(recent("C:/mods/pag/map/setup_scenarios/mine.txt"))).toContain("PaG");
    useOpenScreenStore.setState({ scenarios: [scenarioListing()] });
    expect(shown(recent(scenarioListing().path))).toContain("Plain");
    expect(shown(recent("C:/elsewhere/mine.txt"))).not.toMatch(/PaG|Plain/);
  });

  it("says in the details pane which kind a scenario is, and warns while the mod it needs is off", () => {
    const pane = (painted: boolean) =>
      shown(
        renderToStaticMarkup(
          <OpenDetails row={scenarioRow({ listing: scenarioListing({ painted }) })} />,
        ),
      );
    expect(pane(true)).toContain(SCENARIO_FOR_PAINT.line);
    expect(pane(true)).toContain(PAINT_MOD_OFF_BREAKS);
    expect(pane(false)).toContain(SCENARIO_PLAIN.line);
    expect(pane(false)).not.toContain(PAINT_MOD_OFF_BREAKS);

    usePaintModStore.setState({ paintMod: paintModView({ enabled: true }) });
    expect(pane(true)).not.toContain(PAINT_MOD_OFF_BREAKS);
  });
});

describe("the open screen's footer", () => {
  it("carries New scenario and Browse as buttons, and names no keys", () => {
    const html = renderToStaticMarkup(<OpenSave modal={false} />);
    const foot = html.slice(html.indexOf("open-dialog-foot"));
    expect(buttons(foot)).toEqual(["New scenario…", "Browse…", "Open"]);
    expect(shown(html).match(/Browse…/g)).toHaveLength(1);
    expect(shown(foot)).not.toMatch(/Enter|Ctrl|↵|⇧/);
    expect(shown(html)).not.toContain(PAINT_CHECK);
  });

  it("offers Open as scenario only while a save is selected", () => {
    const recent: RecentDoc = {
      kind: "save",
      path: saveFile().path,
      title: "Terran Federation",
      subtitle: "",
      openedAt: 5,
    };
    useRecentsStore.setState({ recents: [recent] });
    expect(renderToStaticMarkup(<OpenSave modal={false} />)).toContain("Open as scenario");

    useOpenScreenStore.setState({ tab: "scenarios", scenarios: [scenarioListing()] });
    expect(renderToStaticMarkup(<OpenSave modal={false} />)).not.toContain("Open as scenario");
  });

  it("opens a save as a save or as a scenario, and anything else as it is", () => {
    const lists = { ...useOpenScreenStore.getState(), files: { [DIR]: [saveFile()] } };
    const path = saveFile().path;
    expect(footerOpens(saveRow(), lists)).toEqual({
      open: { path, mode: "save" },
      asScenario: { path, mode: "scenario" },
      forPaint: null,
    });
    expect(footerOpens(scenarioRow(), lists)).toEqual({
      open: { path: scenarioListing().path, mode: "save" },
      asScenario: null,
      forPaint: scenarioListing().path,
    });
    expect(footerOpens(scenarioRow({ disabled: true }), lists).open).toBeNull();
    const painted = scenarioRow({ listing: scenarioListing({ painted: true }) });
    expect(footerOpens(painted, lists).forPaint).toBeNull();
    expect(footerOpens(campaignRow(), lists).open).toEqual({ path, mode: "save" });
    expect(footerOpens(campaignRow(), { ...lists, files: {} }).open).toBeNull();
    expect(footerOpens(undefined, lists)).toEqual({ open: null, asScenario: null, forPaint: null });
  });
});

describe("what activating a row does", () => {
  it("asks how to open a save, opens a scenario file at once, and skips the question for the scenario shortcut", () => {
    expect(openRoute("C:/saves/one.sav", false)).toBe("ask");
    expect(openRoute("C:/saves/one.sav", true)).toBe("scenario");
    expect(openRoute("C:/mod/map/setup_scenarios/big.txt", false)).toBe("save");
  });
});

describe("an empire's mark", () => {
  const FLAGGED = saveMeta({
    color: "blue",
    flag: {
      icon: { category: "human", file: "flag_human_9.dds" },
      background: { category: "backgrounds", file: "00_solid.dds" },
      colors: ["blue", "black", "null", "null"],
      use_map_color: false,
    },
  });
  const KEY = "empire_flag:00_solid.dds:human/flag_human_9.dds:blue,black,null,null";

  beforeEach(() => {
    const blue = { name: "blue", map: "#0000ff", flag: "#0000ff", ship: "#0000ff" };
    useGameDataStore.setState({ mapColors: new Map([["blue", blue]]) });
  });

  it("is the colour dot while no flag has been drawn", () => {
    const html = renderToStaticMarkup(<EmpireMark meta={FLAGGED} size="large" />);
    expect(useTextureUrl).toHaveBeenCalledWith([KEY]);
    expect(html).toContain('class="dot"');
    expect(html).not.toContain("<img");
  });

  it("is the flag once game data has drawn it", () => {
    vi.mocked(useTextureUrl).mockReturnValue("data:image/png;base64,AAAA");
    const html = renderToStaticMarkup(<EmpireMark meta={FLAGGED} size="row" />);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('class="dot"');
  });

  it("asks for no flag from a header without one", () => {
    renderToStaticMarkup(<EmpireMark meta={saveMeta()} size="row" />);
    expect(useTextureUrl).toHaveBeenCalledWith([]);
  });
});

describe("the details pane", () => {
  it("shows a save's header, its galaxy and rules once read, and its file", () => {
    const file = saveFile({
      meta: saveMeta({
        name: "Terran Federation",
        planets: 1,
        fleets: 7,
        required_dlcs: ["A", "B", "C", "D", "E", "F", "G"],
      }),
    });
    useGameDataStore.setState({
      summary: gameDataSummary({ version: "4.4.6" }),
      names: new Map([["spiral_3", "3 Arm Spiral"]]),
    });
    useOpenScreenStore.setState({
      details: { [detailsKey(file.path, file.modified)]: { status: "ready", settings: SETTINGS } },
    });

    const html = renderToStaticMarkup(<OpenDetails row={saveRow({ file })} />);
    expect(html).toContain("Terran Federation");
    expect(html).toContain("matches install");
    expect(shown(html)).toMatch(/Planets 1 planet Fleets 7 fleets/);
    expect(html).toContain("3 Arm Spiral");
    expect(html).toContain("Commodore");
    expect(html).toContain("2350");
    expect(html).toContain("2425");
    expect(html).toContain("Required DLC · 7");
    expect(html).toContain("+2");
    expect(html).toContain("C:/saves/terran");
  });

  it("says the settings are being read, and why they could not be", () => {
    expect(renderToStaticMarkup(<OpenDetails row={saveRow()} />)).toContain(
      "Reading the galaxy settings…",
    );
    const file = saveFile();
    useOpenScreenStore.setState({
      details: {
        [detailsKey(file.path, file.modified)]: { status: "error", message: "no galaxy block" },
      },
    });
    expect(renderToStaticMarkup(<OpenDetails row={saveRow()} />)).toContain("no galaxy block");
  });

  it("shows a scenario's empires and setup ranges", () => {
    const listing = scenarioListing({
      source: "mod",
      mod_name: "A Mod",
      enabled: false,
      summary: scenarioSummary({
        empires: { default: 12, max: 16 },
        num_gateways: { min: 1, max: 3, default: 2 },
        num_hyperlanes: { min: 1, max: 1, default: 1 },
      }),
    });
    const html = renderToStaticMarkup(
      <OpenDetails row={scenarioRow({ listing, group: "Workshop mods" })} />,
    );
    expect(html).toContain("A Mod · Workshop mods");
    expect(html).toContain("Not in the playset");
    expect(html).toContain("Up to");
    expect(shown(html)).toContain("Default Up to Empires 12 16");
    expect(html).toContain("1–3");
    expect(html).toContain("100 systems");
  });

  it("shows a campaign's newest save, its save count and the dates its saves span", () => {
    useOpenScreenStore.setState({
      files: {
        [DIR]: [
          saveFile(),
          saveFile({ path: `${DIR}/old.sav`, meta: saveMeta({ date: "2200.01.01" }) }),
        ],
      },
    });
    const html = renderToStaticMarkup(<OpenDetails row={campaignRow()} />);
    expect(html).toContain("3 saves");
    expect(html).toContain("2200.01.01 – 2206.11.16");
    expect(html).toContain("terran_1");
    expect(html).toContain("Reading the galaxy settings…");
  });

  it("says so quietly when nothing is selected", () => {
    expect(renderToStaticMarkup(<OpenDetails row={undefined} />)).toContain("Nothing selected.");
  });
});
