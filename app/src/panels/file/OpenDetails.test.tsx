import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GalaxySettings } from "../../generated/GalaxySettings";
import { gameDataSummary, paintModView, saveMeta, scenarioSummary } from "../../test/builders";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("../useTextureUrl", () => ({ useTextureUrl: vi.fn(() => undefined) }));

import { useGameDataStore } from "../../store/gameDataStore";
import { usePaintModStore } from "../../store/paintModStore";
import { PAINT_MOD_OFF_BREAKS, SCENARIO_FOR_PAINT, SCENARIO_PLAIN } from "../../lib/paintCopy";
import { detailsKey, useOpenScreenStore } from "../../store/openScreenStore";
import {
  DIR,
  campaignRow,
  saveFile,
  saveRow,
  scenarioListing,
  scenarioRow,
  shown,
} from "../../test/openRows";
import { useTextureUrl } from "../useTextureUrl";
import { EmpireMark, OpenDetails } from "./OpenDetails";

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

beforeEach(() => {
  vi.mocked(useTextureUrl).mockReset();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState(), status: "ready" });
  useOpenScreenStore.setState({ ...useOpenScreenStore.getInitialState() });
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
    expect(html).toContain('class="swatch dot"');
    expect(html).not.toContain("<img");
  });

  it("is the flag once game data has drawn it", () => {
    vi.mocked(useTextureUrl).mockReturnValue("data:image/png;base64,AAAA");
    const html = renderToStaticMarkup(<EmpireMark meta={FLAGGED} size="row" />);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('class="swatch dot"');
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

  it("says which kind a scenario is, and warns while the mod it needs is off", () => {
    usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
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
