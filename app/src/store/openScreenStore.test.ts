import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignListing } from "../generated/CampaignListing";
import type { GalaxySettings } from "../generated/GalaxySettings";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioListings } from "../generated/ScenarioListings";
import { TERRAN, VOID, campaignListing, campaignSave, modScenario } from "../test/builders";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import { openSections, type Row, type Section } from "../lib/openRows";
import { detailsKey, useOpenScreenStore } from "./openScreenStore";
import { resetStores } from "./storeFixture";
import { useRecentsStore, type RecentDoc } from "./recentsStore";

const screen = () => useOpenScreenStore.getState();

/** What `list_scenarios` resolves to: the files, and what the mod descriptors could not say. */
function listed(scenarios: ScenarioListing[], diagnostics: string[] = []): ScenarioListings {
  return { scenarios, diagnostics };
}

const RECENT: RecentDoc = {
  kind: "save",
  path: "C:/saves/terran/2206.11.16.sav",
  title: "Terran Federation",
  subtitle: "Terran Federation · 2206.11.16 · v4.4.6",
  openedAt: 5,
};

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
  resetStores();
  mockedIpc.listCampaigns.mockResolvedValue([VOID, TERRAN]);
  mockedIpc.listCampaignSaves.mockResolvedValue([campaignSave()]);
  mockedIpc.listScenarios.mockResolvedValue(listed([modScenario()]));
  mockedIpc.missingPaths.mockResolvedValue([]);
  mockedIpc.closeSave.mockResolvedValue();
  mockedIpc.warmDetails.mockResolvedValue([]);
  mockedIpc.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
});

describe("load", () => {
  it("reads both lists once for one session, newest campaign first and open", async () => {
    await screen().load(null);
    await screen().load(null);

    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(1);
    expect(mockedIpc.listScenarios).toHaveBeenCalledTimes(1);
    expect(screen().campaigns?.map((c) => c.dir)).toEqual([TERRAN.dir, VOID.dir]);
    expect(screen().expanded).toBe(TERRAN.dir);
    expect(mockedIpc.listCampaignSaves).toHaveBeenCalledExactlyOnceWith(TERRAN.dir);
  });

  it("reads again once the session has written a file", async () => {
    await screen().load(null);
    await screen().load("C:/saves/terran/2206.11.16.sav");

    expect(mockedIpc.listCampaigns).toHaveBeenCalledTimes(2);
  });

  it("drops a read that lands after the one a newer token started", async () => {
    let landOld: (c: CampaignListing[]) => void = () => undefined;
    let landOldScenarios: (s: ScenarioListings) => void = () => undefined;
    mockedIpc.listCampaigns.mockReturnValueOnce(new Promise((resolve) => (landOld = resolve)));
    mockedIpc.listScenarios.mockReturnValueOnce(
      new Promise((resolve) => (landOldScenarios = resolve)),
    );
    const older = screen().load(null);
    const newer = screen().load("C:/saves/terran/2206.11.16.sav");
    await newer;

    landOld([campaignListing({ dir: "C:/saves/stale", newest: 999 })]);
    landOldScenarios(listed([modScenario({ path: "C:/stale.txt" })]));
    await older;

    expect(screen().campaigns?.map((c) => c.dir)).toEqual([TERRAN.dir, VOID.dir]);
    expect(screen().scenarios?.map((s) => s.path)).toEqual([modScenario().path]);
    expect(screen().expanded).toBe(TERRAN.dir);
  });

  it("drops a campaign's saves listed for a token that has since changed", async () => {
    await screen().load(null);
    let landOld: (files: SaveFile[]) => void = () => undefined;
    mockedIpc.listCampaignSaves.mockReturnValueOnce(new Promise((resolve) => (landOld = resolve)));
    const expanding = screen().expand(VOID.dir);

    mockedIpc.listCampaignSaves.mockResolvedValue([
      campaignSave({ path: "C:/saves/void/new.sav" }),
    ]);
    await screen().load("C:/saves/terran/2206.11.16.sav");
    landOld([campaignSave({ path: "C:/saves/void/old.sav" })]);
    await expanding;
    await screen().expand(VOID.dir);

    expect(screen().files[VOID.dir]?.map((f) => f.path)).toEqual(["C:/saves/void/new.sav"]);
  });

  it("reports a failing list without hiding the other one", async () => {
    mockedIpc.listCampaigns.mockRejectedValue({ kind: "io", message: "no save folder" });
    await screen().load(null);

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
    await screen().load(null);

    expect(mockedIpc.missingPaths).toHaveBeenCalledExactlyOnceWith([RECENT.path, GONE.path]);
    expect(recentPaths()).toEqual([RECENT.path]);
  });

  it("leaves the list as it was when the check fails", async () => {
    mockedIpc.missingPaths.mockRejectedValue({ kind: "io", message: "no answer" });
    await screen().load(null);

    expect(recentPaths()).toEqual([RECENT.path, GONE.path]);
    expect(screen().campaigns).not.toBeNull();
  });

  it("forgets nothing for a read a newer token overtook", async () => {
    let answerOld: (paths: string[]) => void = () => undefined;
    mockedIpc.missingPaths.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)));
    const older = screen().load(null);
    await screen().load("C:/saves/terran/2206.11.16.sav");

    answerOld([RECENT.path]);
    await older;

    expect(recentPaths()).toEqual([RECENT.path, GONE.path]);
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
    await screen().load(null);
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
    await screen().load(null);
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
    mockedIpc.listScenarios.mockResolvedValue(listed([vanilla, shadowed]));
    await screen().load(null);

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
    await screen().load(null);

    const scenarios = section("scenarios");
    expect(scenarios.notices).toEqual(["C:/user/mod/broken.mod: unexpected } at byte 12"]);
    expect(scenarios.note).toBeNull();
    expect(scenarios.rows.map((r) => r.key)).toEqual([`scenario:${mine.path}`]);
    expect(section("saves").notices).toEqual([]);
  });

  it("keeps no notice from a listing that failed outright", async () => {
    mockedIpc.listScenarios.mockRejectedValue({ kind: "io", message: "the mod folder is gone" });
    await screen().load(null);

    const scenarios = section("scenarios");
    expect(scenarios.notices).toEqual([]);
    expect(scenarios.note).toBe("Could not list scenarios: the mod folder is gone");
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
