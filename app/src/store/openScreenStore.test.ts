import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignListing } from "../generated/CampaignListing";
import type { GalaxySettings } from "../generated/GalaxySettings";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioListings } from "../generated/ScenarioListings";
import { paintModView, saveMeta, scenarioSummary } from "../test/builders";
import { OPEN_RESULT, SCENARIO_RESULT } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import { useFileSessionStore } from "./fileSessionStore";
import { useLayoutStore } from "./layoutStore";
import { usePaintModStore } from "./paintModStore";
import { openSections, type Row, type Section } from "../lib/openRows";
import { detailsKey, resetOpenScreen, useOpenScreenStore } from "./openScreenStore";
import { useRecentsStore, type RecentDoc } from "./recentsStore";

const mocked = {
  listCampaigns: vi.mocked(ipc.listCampaigns),
  listCampaignSaves: vi.mocked(ipc.listCampaignSaves),
  listScenarios: vi.mocked(ipc.listScenarios),
  saveDetails: vi.mocked(ipc.saveDetails),
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
  closeSave: vi.mocked(ipc.closeSave),
  warmDetails: vi.mocked(ipc.warmDetails),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
};

const screen = () => useOpenScreenStore.getState();

function campaign(over: Partial<CampaignListing> = {}): CampaignListing {
  return {
    dir: "C:/saves/terran",
    name: "terran_1",
    empire: "Terran Federation",
    files: 2,
    newest: 200,
    meta: null,
    cloud: false,
    ...over,
  };
}

function save(over: Partial<SaveFile> = {}): SaveFile {
  return {
    path: "C:/saves/terran/2206.11.16.sav",
    campaign: "terran_1",
    file_name: "2206.11.16.sav",
    meta: saveMeta({ name: "Terran Federation", planets: 4, fleets: 7, color: "blue" }),
    modified: 200,
    size: 4096,
    cloud: false,
    ...over,
  };
}

/** What `list_scenarios` resolves to: the files, and what the mod descriptors could not say. */
function listed(scenarios: ScenarioListing[], diagnostics: string[] = []): ScenarioListings {
  return { scenarios, diagnostics };
}

function scenario(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return {
    path: "C:/mods/a/map/setup_scenarios/a.txt",
    name: "a_galaxy",
    systems: 100,
    source: "mod",
    mod_name: "A Mod",
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

const RECENT: RecentDoc = {
  kind: "save",
  path: "C:/saves/terran/2206.11.16.sav",
  title: "Terran Federation",
  subtitle: "Terran Federation · 2206.11.16 · v4.4.6",
  openedAt: 5,
};

const TERRAN = campaign();
const VOID = campaign({
  dir: "C:/saves/void",
  name: "void_2",
  empire: "Void Compact",
  newest: 100,
});

/** The sections as the screen shows them for the current state. */
function sections(): Section[] {
  return openSections(screen(), useRecentsStore.getState().recents);
}

function section(id: string): Section {
  return sections().find((s) => s.id === id)!;
}

function rowKeys(id: string): string[] {
  return (
    sections()
      .find((s) => s.id === id)
      ?.rows.map((r) => r.key) ?? []
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOpenScreen();
  useRecentsStore.setState({ recents: [] });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useLayoutStore.setState({ openDialog: false });
  mocked.listCampaigns.mockResolvedValue([VOID, TERRAN]);
  mocked.listCampaignSaves.mockResolvedValue([save()]);
  mocked.listScenarios.mockResolvedValue(listed([scenario()]));
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
});

describe("load", () => {
  it("reads both lists once for one session, newest campaign first and open", async () => {
    await screen().load(null);
    await screen().load(null);

    expect(mocked.listCampaigns).toHaveBeenCalledTimes(1);
    expect(mocked.listScenarios).toHaveBeenCalledTimes(1);
    expect(screen().campaigns?.map((c) => c.dir)).toEqual([TERRAN.dir, VOID.dir]);
    expect(screen().expanded).toBe(TERRAN.dir);
    expect(mocked.listCampaignSaves).toHaveBeenCalledExactlyOnceWith(TERRAN.dir);
  });

  it("reads again once the session has written a file", async () => {
    await screen().load(null);
    await screen().load("C:/saves/terran/2206.11.16.sav");

    expect(mocked.listCampaigns).toHaveBeenCalledTimes(2);
  });

  it("reports a failing list without hiding the other one", async () => {
    mocked.listCampaigns.mockRejectedValue({ kind: "io", message: "no save folder" });
    await screen().load(null);

    expect(section("saves").note).toBe("Could not list saves: no save folder");
    expect(rowKeys("scenarios")).toContain(`scenario:${scenario().path}`);
  });
});

describe("expand", () => {
  it("reads a campaign's saves when it opens, and keeps them for the next time", async () => {
    await screen().load(null);
    mocked.listCampaignSaves.mockResolvedValue([save({ path: "C:/saves/void/a.sav" })]);

    await screen().toggle(VOID.dir);
    expect(mocked.listCampaignSaves).toHaveBeenCalledTimes(2);
    expect(rowKeys("saves")).toEqual([
      `campaign:${TERRAN.dir}`,
      `campaign:${VOID.dir}`,
      "save:C:/saves/void/a.sav",
    ]);

    await screen().toggle(VOID.dir);
    expect(screen().expanded).toBeNull();
    await screen().toggle(VOID.dir);
    expect(mocked.listCampaignSaves).toHaveBeenCalledTimes(2);
  });

  it("shows a campaign whose saves could not be read", async () => {
    await screen().load(null);
    mocked.listCampaignSaves.mockRejectedValue({ kind: "io", message: "folder is gone" });

    await screen().toggle(VOID.dir);
    const row = section("saves").rows.find((r) => r.key === `campaign:${VOID.dir}`)!;
    expect(row).toMatchObject({ kind: "campaign", error: "folder is gone" });
  });
});

describe("scenarios", () => {
  const mine = scenario({ path: "C:/user/mine.txt", name: "mine", source: "user_mod" });
  const off = scenario({ path: "C:/mods/b.txt", name: "b_galaxy", enabled: false });
  const shadowed = scenario({
    path: "C:/mods/c.txt",
    name: "c_galaxy",
    shadowed_by: "A Mod",
  });
  const vanilla = scenario({
    path: "C:/Stellaris/map/setup_scenarios/default.txt",
    name: "default",
    source: "install",
    mod_name: null,
    error: "commented out",
  });

  it("groups by source in order, enabled workshop mods first", async () => {
    mocked.listScenarios.mockResolvedValue(listed([vanilla, off, shadowed, mine]));
    await screen().load(null);

    const rows = section("scenarios").rows;
    expect(rows.map((r) => r.key)).toEqual([
      `scenario:${mine.path}`,
      `scenario:${shadowed.path}`,
      `scenario:${off.path}`,
      `scenario:${vanilla.path}`,
    ]);
    expect(rows.map((r) => (r.kind === "scenario" ? r.group : null))).toEqual([
      "My mods",
      "Workshop mods",
      "Workshop mods",
      "Install",
    ]);
  });

  it("disables a scenario that could not be read and keeps what overrides one", async () => {
    mocked.listScenarios.mockResolvedValue(listed([vanilla, shadowed]));
    await screen().load(null);

    const rows = section("scenarios").rows.filter((r): r is Row & { kind: "scenario" } =>
      Boolean(r.kind === "scenario"),
    );
    expect(rows.map((r) => r.disabled)).toEqual([false, true]);
    expect(rows[0].listing.shadowed_by).toBe("A Mod");
  });

  it("carries a line per mod descriptor the listing could not read, and still lists the files", async () => {
    mocked.listScenarios.mockResolvedValue(
      listed([mine], ["C:/user/mod/broken.mod: unexpected } at byte 12"]),
    );
    await screen().load(null);

    const scenarios = section("scenarios");
    expect(scenarios.notices).toEqual(["C:/user/mod/broken.mod: unexpected } at byte 12"]);
    expect(scenarios.note).toBeNull();
    expect(scenarios.rows.map((r) => r.key)).toEqual([`scenario:${mine.path}`]);
    expect(section("saves").notices).toEqual([]);
  });

  it("keeps no notice from a listing that failed outright", async () => {
    mocked.listScenarios.mockRejectedValue({ kind: "io", message: "the mod folder is gone" });
    await screen().load(null);

    const scenarios = section("scenarios");
    expect(scenarios.notices).toEqual([]);
    expect(scenarios.note).toBe("Could not list scenarios: the mod folder is gone");
  });
});

describe("open", () => {
  beforeEach(() => {
    useRecentsStore.setState({ recents: [RECENT] });
  });

  it("marks a recent document whose file is gone, and forgets it on request", async () => {
    mocked.openSave.mockRejectedValue({
      kind: "not_found",
      message: "The system cannot find the file specified. (os error 2)",
    });

    await screen().open(RECENT.path, "save");

    expect(screen().rowError?.path).toBe(RECENT.path);
    expect(screen().busy).toBeNull();
    const row = section("recent").rows[0];
    expect(row).toMatchObject({ kind: "recent", missing: true });

    screen().forget(RECENT.path);
    expect(screen().missing).toEqual([]);
    expect(rowKeys("recent")).toEqual([]);
  });

  it("leaves a readable file that failed for another reason listed as it was", async () => {
    mocked.openSave.mockRejectedValue({ kind: "format", message: "meta is not a save header" });

    await screen().open(RECENT.path, "save");

    expect(screen().rowError?.message).toBe("meta is not a save header");
    expect(screen().missing).toEqual([]);
  });

  it("takes a save into a scenario with the standing Paint a Galaxy choice", async () => {
    mocked.openAsScenario.mockResolvedValue(OPEN_RESULT);

    usePaintModStore.setState({ paintChoice: true });
    await screen().open("C:/saves/a.sav", "scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/a.sav", "paint_a_galaxy");

    usePaintModStore.setState({ paintChoice: false });
    await screen().open("C:/saves/b.sav", "scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/b.sav", "plain");
  });

  it("closes the dialog once the document is open", async () => {
    mocked.openSave.mockResolvedValue(OPEN_RESULT);
    useLayoutStore.setState({ openDialog: true });

    await screen().open(OPEN_RESULT.path, "save");

    expect(useFileSessionStore.getState().status).toBe("ready");
    expect(useLayoutStore.getState().openDialog).toBe(false);
  });

  it("leaves the dialog standing when another document is still opening", async () => {
    let finish!: (result: typeof OPEN_RESULT) => void;
    mocked.openSave.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    useLayoutStore.setState({ openDialog: true });
    const first = useFileSessionStore.getState().openSave("C:/saves/terran/other.sav");

    await screen().open(OPEN_RESULT.path, "save");

    expect(useLayoutStore.getState().openDialog).toBe(true);
    expect(screen().rowError?.path).toBe(OPEN_RESULT.path);
    expect(mocked.openSave).toHaveBeenCalledTimes(1);

    finish(OPEN_RESULT);
    await first;
    expect(useFileSessionStore.getState().path).toBe(OPEN_RESULT.path);
  });
});

describe("opening a scenario file", () => {
  const PAINTED = scenario({ path: "C:/mods/a/map/setup_scenarios/painted.txt", painted: true });
  const PLAIN = scenario({ path: "C:/mods/a/map/setup_scenarios/plain.txt" });
  const prompt = () => useFileSessionStore.getState().scenarioPrompt;
  const session = () => useFileSessionStore.getState();

  beforeEach(async () => {
    usePaintModStore.setState({
      ...usePaintModStore.getInitialState(),
      known: true,
      paintMod: paintModView(),
      paintChoice: true,
      warnNotForPaint: true,
    });
    mocked.listScenarios.mockResolvedValue(listed([PAINTED, PLAIN]));
    mocked.openSave.mockResolvedValue(SCENARIO_RESULT);
    await screen().load(null);
  });

  it("opens a scenario for Paint a Galaxy at once while the mod is enabled", async () => {
    await screen().open(PAINTED.path, "save");
    expect(prompt()).toBeNull();
    expect(mocked.openSave).toHaveBeenCalledWith(PAINTED.path);
    expect(session().status).toBe("ready");
  });

  it("asks first about a scenario that isn't for Paint a Galaxy, and opens it as answered", async () => {
    const cancelled = screen().open(PLAIN.path, "save");
    expect(prompt()).toMatchObject({ path: PLAIN.path, kind: "not_for_paint" });
    session().answerScenarioPrompt(null);
    await cancelled;
    expect(mocked.openSave).not.toHaveBeenCalled();

    const opening = screen().open(PLAIN.path, "save");
    session().answerScenarioPrompt("paint_a_galaxy");
    await opening;
    expect(mocked.openSave).toHaveBeenCalledWith(PLAIN.path);
    expect(session().paintChosen).toBe(true);
  });

  it("always asks about a scenario for Paint a Galaxy while the mod is off or unknown", async () => {
    usePaintModStore.setState({
      paintMod: paintModView({ enabled: false }),
      warnNotForPaint: false,
    });
    const opening = screen().open(PAINTED.path, "save");
    expect(prompt()).toMatchObject({ path: PAINTED.path, kind: "paint_mod_off" });
    session().answerScenarioPrompt("plain");
    await opening;
    expect(mocked.openSave).toHaveBeenCalledWith(PAINTED.path);

    usePaintModStore.setState({ known: false, paintMod: null });
    void screen().open(PAINTED.path, "save");
    expect(prompt()?.kind).toBe("paint_mod_off");
    session().answerScenarioPrompt(null);
  });

  it("opens a plain scenario for Paint a Galaxy on request, asking only while the mod is off", async () => {
    await screen().open(PLAIN.path, "save", true);
    expect(prompt()).toBeNull();
    expect(session().paintChosen).toBe(true);

    usePaintModStore.setState({ paintMod: paintModView({ enabled: false }) });
    const opening = screen().open(PLAIN.path, "save", true);
    expect(prompt()).toMatchObject({ path: PLAIN.path, kind: "paint_mod_off", forPaint: true });
    session().answerScenarioPrompt("plain");
    await opening;
    expect(session().paintChosen).toBe(true);
  });

  it("opens any other scenario plain, without asking, once that warning is turned off", async () => {
    usePaintModStore.setState({ warnNotForPaint: false });
    await screen().open(PLAIN.path, "save");
    expect(prompt()).toBeNull();
    expect(mocked.openSave).toHaveBeenCalledWith(PLAIN.path);
    expect(session().paintChosen).toBe(false);

    await screen().open("C:/elsewhere/unlisted.txt", "save");
    expect(prompt()).toBeNull();
    expect(mocked.openSave).toHaveBeenLastCalledWith("C:/elsewhere/unlisted.txt");
  });

  it("asks the same of a scenario file picked with Browse", async () => {
    const asking = session().requestOpen(PLAIN.path);
    await vi.waitFor(() => expect(prompt()?.kind).toBe("not_for_paint"));
    session().answerScenarioPrompt(null);
    await asking;
    expect(mocked.openSave).not.toHaveBeenCalled();

    await session().requestOpen(PAINTED.path);
    expect(mocked.openSave).toHaveBeenCalledWith(PAINTED.path);
  });

  it("asks nothing more of a save once the user chose to edit it as a scenario", async () => {
    mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    await session().requestOpen("C:/saves/a.sav");
    expect(session().pendingOpen).toBe("C:/saves/a.sav");
    await session().chooseOpenMode("scenario");
    expect(prompt()).toBeNull();
    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/a.sav", "paint_a_galaxy");
  });
});

describe("tabs", () => {
  it("keeps the chosen tab, and lists only its section", async () => {
    await screen().load(null);
    screen().setTab("scenarios");

    expect(screen().tab).toBe("scenarios");
    expect(sections().map((s) => s.id)).toEqual(["scenarios"]);
  });
});

describe("loadDetails", () => {
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
  const PATH = save().path;

  it("reads a save once however often it is asked, and again once it was written", async () => {
    mocked.saveDetails.mockResolvedValue(SETTINGS);

    const first = screen().loadDetails(PATH, 200);
    expect(screen().details[detailsKey(PATH, 200)]).toEqual({ status: "loading" });
    await Promise.all([first, screen().loadDetails(PATH, 200)]);
    await screen().loadDetails(PATH, 200);

    expect(mocked.saveDetails).toHaveBeenCalledExactlyOnceWith(PATH);
    expect(screen().details[detailsKey(PATH, 200)]).toEqual({
      status: "ready",
      settings: SETTINGS,
    });

    await screen().loadDetails(PATH, 300);
    expect(mocked.saveDetails).toHaveBeenCalledTimes(2);
  });

  it("keeps the failure for the save it came from", async () => {
    mocked.saveDetails.mockRejectedValue({ kind: "format", message: "no galaxy block" });

    await screen().loadDetails(PATH, 200);

    expect(screen().details[detailsKey(PATH, 200)]).toEqual({
      status: "error",
      message: "no galaxy block",
    });
  });
});
