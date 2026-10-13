import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_SCRIPTS } from "../../../../../store/fixture";

vi.mock("../../../../../api/ipc");
vi.mock("../../../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../../test/zustandSnapshot"));

import { drawnButton, drawnBy } from "../../../../../test/drawn";
import { mockedIpc } from "../../../../../test/ipc";
import { bindStores } from "../../../../../store/bindStores";
import { useInspectorStore } from "../../../../../store/inspectorStore";
import { useScriptEditorStore } from "../../../../../store/scriptEditorStore";
import { useScriptsStore } from "../../../../../store/scriptsStore";
import {
  details,
  land,
  open,
  overview,
  resetStores,
  sections,
  SYSTEM,
} from "../../../inspectorFixture";
import { SCRIPTS_LIMITS, SCRIPTS_TAB_TITLE } from "./ScriptsTab";

const SCRIPTS_LIMITS_HTML = SCRIPTS_LIMITS.replace(/'/g, "&#x27;");

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
  useScriptEditorStore.setState({ ...useScriptEditorStore.getInitialState() });
});

/** The heads the Scripts section groups its rows under, in the order it writes them. */
function groups(html: string): string[] {
  return [...html.matchAll(/class="muted ins-spawn-head">([^<]*)</g)].map((m) => m[1]);
}

describe("a scenario system's scripts", () => {
  beforeEach(() => {
    useInspectorStore.setState({ tab: "scripts" });
  });

  it("sends the reader from the Overview's closed row to the tab that lists them", async () => {
    useInspectorStore.setState({ tab: "overview" });
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });

    const row = overview();
    expect(sections(row)).toContain("Scripts · 5");
    expect(row).toContain(SCRIPTS_TAB_TITLE);
    expect(row).toContain(">scripts<");
    // The rows themselves are the tab's, not the Overview's.
    expect(row).not.toContain("empire_capital_init");
    expect(row).not.toContain(SCRIPTS_LIMITS_HTML);

    useInspectorStore.getState().setTab("scripts");
    const tab = overview();
    expect(sections(tab)).not.toContain("Scripts · 5");
    expect(tab).toContain("empire_capital_init");
    expect(tab).toContain(SCRIPTS_LIMITS_HTML);
  });

  it("shows the closed row's count as still reading, then unavailable once the read fails", async () => {
    useInspectorStore.setState({ tab: "overview" });
    await open("scenario");

    expect(sections(overview())).toContain("Scripts · …");

    useScriptsStore.setState({ failed: new Map([[SYSTEM, "no game data is loaded"]]) });
    const html = overview();
    expect(sections(html)).toContain("Scripts · unavailable");
  });

  it("groups every kind the chain reaches and says when each runs and where it lives", async () => {
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });

    const html = overview();
    // The system's own initializer and the scenario effect are pinned above the groups.
    expect(groups(html).slice(-3)).toEqual(["Scripted effects", "Events", "On actions"]);
    expect(html.indexOf("empire_capital_init")).toBeLessThan(html.indexOf("Scripted effects"));
    expect(html).toContain("Fixture Capital");
    expect(html).toContain("at generation");
    expect(html).toContain("runs later");
    expect(html).toContain("timing unknown");
    expect(html).toContain("has_star_flag = fixture_beacon");
    expect(html).toContain("event_target:fixture_empire");
    expect(html).toContain("fired by on_game_start");
    expect(html).toContain("events/zz_fixture_events.txt:7");
    expect(html).toContain(SCRIPTS_LIMITS_HTML);
    expect(html).not.toContain("showing the first");

    expect(html).toContain(
      '<button type="button" class="link ins-script-open" title="C:/mods/one/events/zz_fixture_events.txt">Open file</button>',
    );
    expect(html).toContain('aria-label="Show zz_fixture_events.txt in Explorer"');
    // The scenario's own effect is a line of the open document, which has no folder to show.
    expect(html).toContain("my_galaxy.txt:41");
    expect(html).toContain('title="C:/mods/map/setup_scenarios/my_galaxy.txt">Open file</button>');
    expect(html).not.toContain("my_galaxy.txt in Explorer");
  });

  it("opens each script in the remembered editor at the line it names the system on", async () => {
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });
    const pick = { kind: "found", id: "vscode" } as const;
    useScriptEditorStore.setState({ choice: { pick, name: "VS Code", remember: true } });
    mockedIpc.openInEditor.mockResolvedValue({ fell_back: false, steam_replaces: false });

    const html = drawnBy(overview);
    expect(html).toContain(">Open in VS Code</button>");
    drawnButton("C:/mods/one/events/zz_fixture_events.txt").onClick();
    expect(mockedIpc.openInEditor).toHaveBeenCalledWith(
      "C:/mods/one/events/zz_fixture_events.txt",
      7,
      pick,
    );
    drawnButton("C:/mods/map/setup_scenarios/my_galaxy.txt").onClick();
    expect(mockedIpc.openInEditor).toHaveBeenCalledWith(
      "C:/mods/map/setup_scenarios/my_galaxy.txt",
      41,
      pick,
    );
  });

  it("makes a script that names the system on several lines one row that opens onto them", async () => {
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });

    const html = overview();
    // One row for the script, counted, summarised by the ways in rather than by one line.
    expect(html.match(/>create_fixture_empire<\/span>/g)).toHaveLength(1);
    expect(html).toContain("×3");
    expect(html).toContain("call, has_star_flag · one");
    // Its three lines, each with its own phrase and its own way out to the file.
    expect(html).toContain(":3</span>");
    expect(html).toContain("called by the chain");
    expect(html).toContain("calls create_fixture_empire");
    expect(html).toContain("has_star_flag = fixture_core");
    expect(
      html.match(/title="C:\/mods\/one\/common\/scripted_effects\/zz_countries.txt">Open file</g),
    ).toHaveLength(4);
  });

  it("says so when the backend stopped at its row limit", async () => {
    await open("scenario");
    useScriptsStore.setState({
      scripts: new Map([[SYSTEM, { ...SYSTEM_SCRIPTS, truncated: true }]]),
    });

    expect(overview()).toContain("showing the first 200");
  });

  it("waits for the reading, says when nothing reaches the system, and reports a failure", async () => {
    await open("scenario");
    expect(overview()).toContain("Reading the scripts");

    useScriptsStore.setState({ missing: new Set([SYSTEM]) });
    expect(overview()).toContain("No scripts in the loaded game data reach this system.");

    useScriptsStore.setState({
      missing: new Set(),
      failed: new Map([[SYSTEM, "no game data is loaded"]]),
    });
    expect(overview()).toContain("The scripts could not be read: no game data is loaded");
  });

  it("asks for none of it on a save, whose systems carry no scripts", async () => {
    useInspectorStore.setState({ tab: "overview" });
    await open("save");
    await land(details());
    const shown = sections(overview());
    expect(shown).toContain("Hyperlanes · 4");
    expect(shown.filter((title) => title.startsWith("Scripts"))).toEqual([]);
  });
});
