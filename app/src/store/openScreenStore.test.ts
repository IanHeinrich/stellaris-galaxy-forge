import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignListing } from "../generated/CampaignListing";
import type { GalaxySettings } from "../generated/GalaxySettings";
import type { SaveFile } from "../generated/SaveFile";
import { TERRAN, VOID, campaignSave, modScenario } from "../test/builders";

vi.mock("../api/ipc");
vi.mock("../api/events");

const focus = vi.hoisted(() => {
  const state = {
    handler: null as ((e: { payload: boolean }) => void) | null,
    unlisten: vi.fn(),
  };
  return state;
});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (handler: (e: { payload: boolean }) => void) => {
      focus.handler = handler;
      return Promise.resolve(focus.unlisten);
    },
  }),
}));

import { flush } from "../test/flush";
import { mockedIpc } from "../test/ipc";
import { footerOpens, navigableRows, selectedRow, type Row } from "../lib/openRows";
import { useFileSessionStore } from "./fileSessionStore";
import { useLayoutStore } from "./layoutStore";
import {
  detailsKey,
  showOpenScreen,
  useOpenScreenStore,
  watchWindowFocus,
} from "./openScreenStore";
import {
  RECENT,
  armScreen,
  listed,
  rowKeys,
  screen,
  section,
  sections,
} from "./openScreenStore.fixture";
import { useRecentsStore, type RecentDoc } from "./recentsStore";

beforeEach(armScreen);

describe("load", () => {
  it("reads both lists once while a read is under way, newest campaign first and open", async () => {
    const first = screen().load();
    await screen().load();
    await first;

    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(1);
    expect(mockedIpc.listScenarios).toHaveBeenCalledTimes(1);
    expect(screen().campaigns?.map((c) => c.dir)).toEqual([TERRAN.dir, VOID.dir]);
    expect(screen().expanded).toBe(TERRAN.dir);
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledExactlyOnceWith(TERRAN.dir);
  });

  it("reads again each time the screen is shown, keeping the open campaign while it is there", async () => {
    const autosave = campaignSave({
      path: `${VOID.dir}/autosave_2231.01.01.sav`,
      campaign: VOID.name,
      file_name: "autosave_2231.01.01.sav",
      modified: 300,
    });
    await screen().load();
    await screen().expand(VOID.dir);
    screen().setFilter("void");
    mockedIpc.listCampaignSaves.mockResolvedValue([autosave]);
    await screen().load();

    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(2);
    expect(screen().filter).toBe("void");
    expect(rowKeys("saves")).toEqual([`campaign:${VOID.dir}`, `save:${autosave.path}`]);

    screen().setFilter("");
    mockedIpc.listCampaigns.mockResolvedValue([TERRAN]);
    await screen().load();
    expect(screen().expanded).toBe(TERRAN.dir);
  });

  it("keeps the open campaign's saves on screen until a new read replaces them", async () => {
    await screen().load();
    let land: (c: CampaignListing[]) => void = () => undefined;
    mockedIpc.listCampaigns.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const again = screen().load();

    expect(rowKeys("saves")).toEqual([
      `campaign:${TERRAN.dir}`,
      `save:${campaignSave().path}`,
      `campaign:${VOID.dir}`,
    ]);
    land([VOID, TERRAN]);
    await again;
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledTimes(2);
    expect(rowKeys("saves")).toContain(`save:${campaignSave().path}`);
  });

  it("drops a campaign's saves listed for a read of the lists that has since been redone", async () => {
    await screen().load();
    let landOld: (files: SaveFile[]) => void = () => undefined;
    mockedIpc.listCampaignSaves.mockReturnValueOnce(new Promise((resolve) => (landOld = resolve)));
    const expanding = screen().expand(VOID.dir);

    mockedIpc.listCampaignSaves.mockResolvedValue([
      campaignSave({ path: "C:/saves/void/new.sav" }),
    ]);
    await screen().load();
    landOld([campaignSave({ path: "C:/saves/void/old.sav" })]);
    await expanding;
    await screen().expand(VOID.dir);

    expect(screen().files[VOID.dir]?.map((f) => f.path)).toEqual(["C:/saves/void/new.sav"]);
  });

  it("reports a failing list without hiding the other one", async () => {
    mockedIpc.listCampaigns.mockRejectedValue({ kind: "io", message: "no save folder" });
    await screen().load();

    expect(section("saves").note).toBe("Could not list saves: no save folder");
    expect(rowKeys("scenarios")).toContain(`scenario:${modScenario().path}`);
  });
});

describe("recent documents", () => {
  const GONE: RecentDoc = { ...RECENT, path: "C:/saves/terran/deleted.sav", openedAt: 4 };

  beforeEach(() => {
    useRecentsStore.setState({ recents: [RECENT, GONE] });
  });

  const recentPaths = () => useRecentsStore.getState().recents.map((r) => r.path);

  it("forgets the ones whose files are gone when the lists are read", async () => {
    mockedIpc.missingPaths.mockResolvedValue([GONE.path]);
    await screen().load();

    expect(mockedIpc.missingPaths).toHaveBeenCalledExactlyOnceWith([RECENT.path, GONE.path]);
    expect(recentPaths()).toEqual([RECENT.path]);
  });

  it("leaves the list as it was when the check fails", async () => {
    mockedIpc.missingPaths.mockRejectedValue({ kind: "io", message: "no answer" });
    await screen().load();

    expect(recentPaths()).toEqual([RECENT.path, GONE.path]);
    expect(screen().campaigns).not.toBeNull();
  });

  it("clears the list and the not-found marks", async () => {
    useOpenScreenStore.setState({ missing: [GONE.path] });

    screen().clear();

    expect(recentPaths()).toEqual([]);
    expect(screen().missing).toEqual([]);
  });
});

describe("expand", () => {
  it("reads a campaign's saves when it opens, and keeps them for the next time", async () => {
    await screen().load();
    mockedIpc.listCampaignSaves.mockResolvedValue([campaignSave({ path: "C:/saves/void/a.sav" })]);

    await screen().toggle(VOID.dir);
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledTimes(2);
    expect(rowKeys("saves")).toEqual([
      `campaign:${TERRAN.dir}`,
      `campaign:${VOID.dir}`,
      "save:C:/saves/void/a.sav",
    ]);

    await screen().toggle(VOID.dir);
    expect(screen().expanded).toBeNull();
    await screen().toggle(VOID.dir);
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledTimes(2);
  });

  it("shows a campaign whose saves could not be read", async () => {
    await screen().load();
    mockedIpc.listCampaignSaves.mockRejectedValue({ kind: "io", message: "folder is gone" });

    await screen().toggle(VOID.dir);
    const row = section("saves").rows.find((r) => r.key === `campaign:${VOID.dir}`)!;
    expect(row).toMatchObject({ kind: "campaign", error: "folder is gone" });
  });
});

describe("scenarios", () => {
  const mine = modScenario({ path: "C:/user/mine.txt", name: "mine", source: "user_mod" });
  const off = modScenario({ path: "C:/mods/b.txt", name: "b_galaxy", enabled: false });
  const shadowed = modScenario({
    path: "C:/mods/c.txt",
    name: "c_galaxy",
    shadowed_by: "A Mod",
  });
  const vanilla = modScenario({
    path: "C:/Stellaris/map/setup_scenarios/default.txt",
    name: "default",
    source: "install",
    mod_name: null,
    error: "commented out",
  });

  it("groups by source in order, enabled workshop mods first", async () => {
    mockedIpc.listScenarios.mockResolvedValue(listed([vanilla, off, shadowed, mine]));
    await screen().load();

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
    mockedIpc.listScenarios.mockResolvedValue(listed([vanilla, shadowed]));
    await screen().load();

    const rows = section("scenarios").rows.filter((r): r is Row & { kind: "scenario" } =>
      Boolean(r.kind === "scenario"),
    );
    expect(rows.map((r) => r.disabled)).toEqual([false, true]);
    expect(rows[0].listing.shadowed_by).toBe("A Mod");
  });

  it("carries a line per mod descriptor the listing could not read, and still lists the files", async () => {
    mockedIpc.listScenarios.mockResolvedValue(
      listed([mine], ["C:/user/mod/broken.mod: unexpected } at byte 12"]),
    );
    await screen().load();

    const scenarios = section("scenarios");
    expect(scenarios.notices).toEqual(["C:/user/mod/broken.mod: unexpected } at byte 12"]);
    expect(scenarios.note).toBeNull();
    expect(scenarios.rows.map((r) => r.key)).toEqual([`scenario:${mine.path}`]);
    expect(section("saves").notices).toEqual([]);
  });

  it("keeps no notice from a listing that failed outright", async () => {
    mockedIpc.listScenarios.mockRejectedValue({ kind: "io", message: "the mod folder is gone" });
    await screen().load();

    const scenarios = section("scenarios");
    expect(scenarios.notices).toEqual([]);
    expect(scenarios.note).toBe("Could not list scenarios: the mod folder is gone");
  });
});

describe("filter", () => {
  it("finds a save by its file name in a campaign not yet opened, reading only that one", async () => {
    const giga = campaignSave({
      path: `${VOID.dir}/basic_with_giga.sav`,
      campaign: VOID.name,
      file_name: "basic_with_giga.sav",
      meta: null,
    });
    const listing = { ...VOID, file_names: ["2230.01.01.sav", giga.file_name] };
    mockedIpc.listCampaigns.mockResolvedValue([listing, TERRAN]);
    mockedIpc.listCampaignSaves.mockImplementation((dir) =>
      Promise.resolve(dir === VOID.dir ? [giga] : [campaignSave()]),
    );
    await screen().load();

    for (const typed of ["basic_with_giga", "Basic_With_Giga.SAV"]) {
      screen().setFilter(typed);
      expect(section("saves").count).toBe(1);
      await flush();
      expect(rowKeys("saves")).toEqual([`campaign:${VOID.dir}`, `save:${giga.path}`]);
      expect(section("saves").count).toBe(1);
    }
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledTimes(2);
    expect(mockedIpc.listCampaignSaves).toHaveBeenLastCalledWith(VOID.dir);
  });
});

describe("filter by what a save is known by", () => {
  it("reads a campaign the filter keeps by its name and a file name together", async () => {
    const autosave = campaignSave({
      path: `${VOID.dir}/autosave_2229.07.01.sav`,
      campaign: VOID.name,
      file_name: "autosave_2229.07.01.sav",
      meta: null,
    });
    const listing = { ...VOID, file_names: ["2230.01.01.sav", autosave.file_name] };
    mockedIpc.listCampaigns.mockResolvedValue([listing, TERRAN]);
    mockedIpc.listCampaignSaves.mockImplementation((dir) =>
      Promise.resolve(dir === VOID.dir ? [autosave] : [campaignSave()]),
    );
    await screen().load();

    screen().setFilter("void_2 autosave");
    expect(section("saves").count).toBe(1);
    await flush();
    expect(rowKeys("saves")).toEqual([`campaign:${VOID.dir}`, `save:${autosave.path}`]);
  });

  it("asks once per read of the lists for a folder that could not be listed", async () => {
    await screen().load();
    const listing = { ...VOID, file_names: ["basic_with_giga.sav"] };
    mockedIpc.listCampaigns.mockResolvedValue([listing, TERRAN]);
    await screen().load();
    mockedIpc.listCampaignSaves.mockRejectedValue({ kind: "io", message: "folder is gone" });

    for (const typed of ["basic", "basic_", "basic_with"]) {
      screen().setFilter(typed);
      await flush();
    }
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledTimes(3);
    expect(section("saves").rows[0]).toMatchObject({ kind: "campaign", error: "folder is gone" });
  });
});

describe("latest save", () => {
  it("is selected when the screen opens, and Open opens it as a save", async () => {
    const newer = { ...VOID, newest: 300, file_names: ["autosave_2231.01.01.sav"] };
    mockedIpc.listCampaigns.mockResolvedValue([TERRAN, newer]);
    await screen().load();

    const row = selectedRow(navigableRows(sections()), null);
    expect(row).toMatchObject({ kind: "latest", path: `${VOID.dir}/autosave_2231.01.01.sav` });
    const target = footerOpens(row, screen()).open!;
    await screen().open(target.path, target.mode);
    expect(mockedIpc.openDocument.mock.lastCall?.[0]).toBe(`${VOID.dir}/autosave_2231.01.01.sav`);
  });
});

describe("reading the lists again while the screen shows", () => {
  it("reads on File → Open… while the start screen or the dialog shows, and opens the dialog otherwise", async () => {
    await screen().load();
    showOpenScreen();
    await flush();
    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(2);

    useFileSessionStore.setState({ status: "ready" });
    showOpenScreen();
    await flush();
    expect(useLayoutStore.getState().openDialog).toBe(true);
    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(2);

    showOpenScreen();
    await flush();
    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(3);
  });

  it("reads each time the window regains focus while watched, and stops when unwatched", async () => {
    await screen().load();
    const unwatch = watchWindowFocus();

    focus.handler?.({ payload: false });
    await flush();
    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(1);
    focus.handler?.({ payload: true });
    await flush();
    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(2);

    unwatch();
    await flush();
    expect(focus.unlisten).toHaveBeenCalledOnce();
  });
});

describe("tabs", () => {
  it("keeps the chosen tab, and lists only its section", async () => {
    await screen().load();
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
    victory_year: null,
    cosmic_storm_early_game_spawn_chance_scale: null,
    cosmic_storm_mid_game_spawn_chance_scale: null,
    cosmic_storm_late_game_spawn_chance_scale: null,
    cosmic_storm_early_game_spawn_max_cap: null,
    cosmic_storm_mid_game_spawn_max_cap: null,
    cosmic_storm_late_game_spawn_max_cap: null,
    cosmic_storm_spawn_cooldown_scale: null,
    cosmic_storm_devastation: null,
    voidworms_scaling: null,
    cutholoids_scaling: null,
    fallen_empire_strength_scale: null,
    ironman: false,
    core_radius: 120,
  };
  const PATH = campaignSave().path;

  it("reads a save once however often it is asked, and again once it was written", async () => {
    mockedIpc.saveDetails.mockResolvedValue(SETTINGS);

    const first = screen().loadDetails(PATH, 200);
    expect(screen().details[detailsKey(PATH, 200)]).toEqual({ status: "loading" });
    await Promise.all([first, screen().loadDetails(PATH, 200)]);
    await screen().loadDetails(PATH, 200);

    expect(mockedIpc.saveDetails).toHaveBeenCalledExactlyOnceWith(PATH);
    expect(screen().details[detailsKey(PATH, 200)]).toEqual({
      status: "ready",
      settings: SETTINGS,
    });

    await screen().loadDetails(PATH, 300);
    expect(mockedIpc.saveDetails).toHaveBeenCalledTimes(2);
  });

  it("keeps the failure for the save it came from", async () => {
    mockedIpc.saveDetails.mockRejectedValue({ kind: "format", message: "no galaxy block" });

    await screen().loadDetails(PATH, 200);

    expect(screen().details[detailsKey(PATH, 200)]).toEqual({
      status: "error",
      message: "no galaxy block",
    });
  });
});
