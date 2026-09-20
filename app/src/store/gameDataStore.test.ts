import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Progress } from "../generated/Progress";
import type { ScenarioOwners } from "../generated/ScenarioOwners";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("../lib/visual/textures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/visual/textures")>();
  return { ...actual, clearTextures: vi.fn() };
});

import * as ipc from "../api/ipc";
import { templateKey } from "../lib/names";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import {
  armGameData,
  flush,
  GALAXY_KEYS,
  listeners,
  mocked,
  releaseGameData,
  RIHINAR,
  SPECIAL,
  SUMMARY,
} from "./gameDataFixture";
import { OPEN_RESULT, SCENARIO_BYPASSES, SCENARIO_OWNERS, TERRITORY } from "./fixture";

beforeEach(armGameData);
afterEach(releaseGameData);

describe("load", () => {
  it("sets the summary, loads the registries and names, and reports progress meanwhile", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const p = useGameDataStore.getState().load();
    await vi.waitFor(() => expect(listeners.progress).not.toBeNull());
    expect(useGameDataStore.getState().status).toBe("loading");
    const progress: Progress = { phase: "definitions", fraction: 0.4 };
    listeners.progress!(progress);
    expect(useGameDataStore.getState().progress).toEqual(progress);
    await p;

    const state = useGameDataStore.getState();
    expect(state.status).toBe("ready");
    expect(state.summary).toBe(SUMMARY);
    expect(state.progress).toBeNull();
    expect(state.error).toBeNull();
    expect(listeners.unlisten).toHaveBeenCalledTimes(1);
    expect(mocked.loadGameData).toHaveBeenCalledWith(undefined);

    expect(state.starClasses.get("sc_g")?.texture_key).toBe("star_class:g");
    expect(state.mapColors.get("red")?.map).toBe("#ff0000");
    expect(state.planetClasses.get("pc_continental")?.habitable).toBe(true);
    expect(state.deposits.get("d_minerals_5")?.produces).toEqual([["minerals", 5]]);
    expect(state.bypasses.get("gateway")?.icon_frame).toBe(25);
    expect(state.bypasses.get("relay_bypass")?.icon_frame).toBeNull();
    expect(state.starbaseLevels.get("starbase_outpost")?.icon_frame).toBe(1);
    expect(state.shipSizes.get("corvette")?.icon).toBe("ship_size_military_1");
    expect(useDetailsStore.getState().resourceIcons.get("energy")).toBe("GFX_resource_energy");
    expect(state.countryTypes.get("amoeba")?.is_space_critter).toBe(true);

    expect(state.special.get(4)?.primary).toBe("landmark");
    expect(state.counts).toEqual(SPECIAL.counts);
    expect(state.specialWithGameData).toBe(true);

    expect(mocked.getNames).toHaveBeenCalledTimes(1);
    expect(mocked.getNames).toHaveBeenCalledWith(GALAXY_KEYS);
    expect(state.displayNameOf("NAME_Sol")).toBe("Sol");
    expect(state.displayNameOf("NAME_Nowhere")).toBeUndefined();
  });

  it("skips the special systems and names when no save is open", async () => {
    await useGameDataStore.getState().load();
    expect(useGameDataStore.getState().status).toBe("ready");
    expect(mocked.getSpecialSystems).not.toHaveBeenCalled();
    expect(mocked.getNames).not.toHaveBeenCalled();
    expect(useGameDataStore.getState().special.size).toBe(0);
  });

  it("a rejection sets the error state and keeps the message", async () => {
    mocked.loadGameData.mockRejectedValueOnce({
      kind: "no_install",
      message: "no Stellaris install found; searched C:/Steam, D:/Steam",
    });
    await useGameDataStore.getState().load();
    const state = useGameDataStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("no Stellaris install found; searched C:/Steam, D:/Steam");
    expect(state.summary).toBeNull();
    expect(mocked.getStarClasses).not.toHaveBeenCalled();
    expect(listeners.unlisten).toHaveBeenCalledTimes(1);
  });

  it("remembers a given install path and reuses it when none is given", async () => {
    await useGameDataStore.getState().load("D:/Games/Stellaris");
    expect(mocked.loadGameData).toHaveBeenLastCalledWith("D:/Games/Stellaris");
    expect(listeners.storage.get("sgf.installPath")).toBe("D:/Games/Stellaris");

    useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
    await useGameDataStore.getState().load();
    expect(mocked.loadGameData).toHaveBeenLastCalledWith("D:/Games/Stellaris");
  });

  it("a failed load does not remember the path", async () => {
    mocked.loadGameData.mockRejectedValueOnce({ kind: "no_install", message: "nope" });
    await useGameDataStore.getState().load("D:/Nowhere");
    expect(listeners.storage.has("sgf.installPath")).toBe(false);
  });
});

describe("sync", () => {
  it("adopts game data the backend already holds and loads the registries and names", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    vi.mocked(ipc.gameDataSummary).mockResolvedValue(SUMMARY);
    await useGameDataStore.getState().sync();

    const state = useGameDataStore.getState();
    expect(state.status).toBe("ready");
    expect(state.summary).toBe(SUMMARY);
    expect(mocked.loadGameData).not.toHaveBeenCalled();
    expect(mocked.getStarClasses).toHaveBeenCalledTimes(1);
    expect(state.specialWithGameData).toBe(true);
    expect(mocked.getNames).toHaveBeenCalledWith(GALAXY_KEYS);
    expect(mocked.clearTextures).toHaveBeenCalledTimes(1);
  });

  it("stays idle when the backend holds none", async () => {
    vi.mocked(ipc.gameDataSummary).mockResolvedValue(null);
    await useGameDataStore.getState().sync();
    expect(useGameDataStore.getState().status).toBe("idle");
    expect(mocked.getStarClasses).not.toHaveBeenCalled();
  });
});

describe("fetchNames", () => {
  it("is a no-op without game data", async () => {
    await useGameDataStore.getState().fetchNames(["NAME_Sol"]);
    expect(mocked.getNames).not.toHaveBeenCalled();
  });

  it("dedupes known keys and batches at most 500 per call", async () => {
    await useGameDataStore.getState().load();
    const keys = Array.from({ length: 1200 }, (_, i) => `NAME_${i}`);
    await useGameDataStore.getState().fetchNames(keys);
    expect(mocked.getNames).toHaveBeenCalledTimes(3);
    expect(mocked.getNames.mock.calls.map(([k]) => k.length)).toEqual([500, 500, 200]);
    expect(useGameDataStore.getState().names.size).toBe(1200);

    mocked.getNames.mockClear();
    await useGameDataStore.getState().fetchNames([...keys.slice(0, 10), "NAME_new", "NAME_new"]);
    expect(mocked.getNames).toHaveBeenCalledTimes(1);
    expect(mocked.getNames).toHaveBeenCalledWith(["NAME_new"]);
    expect(useGameDataStore.getState().displayNameOf("NAME_new")).toBe("new");
  });
});

describe("resolveNames", () => {
  const country = (n: number) => ({
    key: "%ADJECTIVE%",
    literal: false,
    variables: [{ name: "adjective", value: { key: `SPEC_${n}`, literal: false, variables: [] } }],
  });

  it("resolves without game data too, since the backend stands in for a template", async () => {
    await useGameDataStore.getState().resolveNames([country(0)]);
    expect(mocked.resolveNames).toHaveBeenCalledWith([country(0)]);
  });

  it("asks again for a batch the backend refused", async () => {
    await useGameDataStore.getState().load();
    mocked.resolveNames.mockRejectedValueOnce({ kind: "ipc", message: "the bridge is gone" });
    await useGameDataStore.getState().resolveNames([country(3001)]);
    expect(useGameDataStore.getState().error).toBe("the bridge is gone");

    await useGameDataStore.getState().resolveNames([country(3001)]);
    expect(useGameDataStore.getState().names.get(templateKey(country(3001)))).toBe("SPEC_3001");
  });

  it("a fresh load resolves everything again, so another install leaves no stale text", async () => {
    await useGameDataStore.getState().load();
    await useGameDataStore.getState().resolveNames([country(4001)]);
    expect(useGameDataStore.getState().names.size).toBe(1);

    await useGameDataStore.getState().load("D:/Other/Stellaris");
    expect(useGameDataStore.getState().names.size).toBe(0);
    mocked.resolveNames.mockClear();
    await useGameDataStore.getState().resolveNames([country(4001)]);
    expect(mocked.resolveNames).toHaveBeenCalledWith([country(4001)]);
  });

  it("caches by template, asks once, and batches at most 500 per call", async () => {
    await useGameDataStore.getState().load();
    const names = Array.from({ length: 1200 }, (_, i) => country(i));
    await useGameDataStore.getState().resolveNames(names);
    expect(mocked.resolveNames).toHaveBeenCalledTimes(3);
    expect(mocked.resolveNames.mock.calls.map(([n]) => n.length)).toEqual([500, 500, 200]);
    expect(useGameDataStore.getState().names.get(templateKey(country(7)))).toBe("SPEC_7");

    mocked.resolveNames.mockClear();
    await useGameDataStore.getState().resolveNames([country(7), country(1200), country(1200)]);
    expect(mocked.resolveNames).toHaveBeenCalledTimes(1);
    expect(mocked.resolveNames).toHaveBeenCalledWith([country(1200)]);
  });

  it("requestName resolves the names a render asked for together", async () => {
    await useGameDataStore.getState().load();
    useGameDataStore.getState().requestName(country(2001));
    useGameDataStore.getState().requestName(country(2002));
    useGameDataStore.getState().requestName(country(2001));
    expect(mocked.resolveNames).not.toHaveBeenCalled();

    await vi.waitFor(() =>
      expect(useGameDataStore.getState().names.get(templateKey(country(2002)))).toBe("SPEC_2002"),
    );
    expect(mocked.resolveNames).toHaveBeenCalledTimes(1);
    expect(mocked.resolveNames).toHaveBeenCalledWith([country(2001), country(2002)]);
  });
});

describe("names the game data no longer wants", () => {
  const template = (n: number) => ({
    key: "%ADJECTIVE%",
    literal: false,
    variables: [{ name: "adjective", value: { key: `SPEC_${n}`, literal: false, variables: [] } }],
  });

  it("an answer that lands after an unload writes nothing and reports nothing", async () => {
    await useGameDataStore.getState().load();
    let finishKeys!: (names: Record<string, string>) => void;
    let finishTemplates!: (names: string[]) => void;
    mocked.getNames.mockReturnValueOnce(new Promise((resolve) => (finishKeys = resolve)));
    mocked.resolveNames.mockReturnValueOnce(new Promise((resolve) => (finishTemplates = resolve)));
    const fetching = useGameDataStore.getState().fetchNames(["NAME_Sol"]);
    const resolving = useGameDataStore.getState().resolveNames([template(9001)]);

    await useGameDataStore.getState().unload();
    finishKeys({ NAME_Sol: "Sol" });
    finishTemplates(["Solarian"]);
    await Promise.all([fetching, resolving]);

    const state = useGameDataStore.getState();
    expect(state.names.size).toBe(0);
    expect(state.error).toBeNull();
  });

  it("a batch the backend refuses after an unload leaves no error behind", async () => {
    await useGameDataStore.getState().load();
    let refuse!: (e: unknown) => void;
    mocked.getNames.mockReturnValueOnce(new Promise((_resolve, reject) => (refuse = reject)));
    const fetching = useGameDataStore.getState().fetchNames(["NAME_Sol"]);

    await useGameDataStore.getState().unload();
    refuse({ kind: "no_game_data", message: "not loaded" });
    await fetching;

    expect(useGameDataStore.getState().error).toBeNull();
  });
});

describe("initializers", () => {
  const INITIALIZERS = [
    {
      name: "sol_system",
      source: "C:/Stellaris/common/solar_system_initializers/sol_initializers.txt",
      display_name: null,
      class: null,
      usage: "misc_system_init",
      empire_spawn: false,
      max_instances: null,
      flags: [],
      countries: [],
      spawns: [],
      planets: [],
      planet_count: 0,
    },
    {
      name: "hole_init",
      source: "C:/Stellaris/common/solar_system_initializers/distant_stars_initializers.txt",
      display_name: null,
      class: "sc_black_hole",
      usage: "misc_system_init",
      empire_spawn: false,
      max_instances: null,
      flags: [],
      countries: [],
      spawns: [],
      planets: [],
      planet_count: 0,
    },
  ];

  it("is a no-op without game data", async () => {
    await useGameDataStore.getState().loadInitializers();
    expect(mocked.getInitializers).not.toHaveBeenCalled();
    expect(useGameDataStore.getState().initializers).toBeNull();
  });

  it("reads them once on first use and drops them on unload", async () => {
    mocked.getInitializers.mockResolvedValue(INITIALIZERS);
    await useGameDataStore.getState().load();
    expect(useGameDataStore.getState().initializers).toBeNull();
    expect(mocked.getInitializers).not.toHaveBeenCalled();

    await Promise.all([
      useGameDataStore.getState().loadInitializers(),
      useGameDataStore.getState().loadInitializers(),
    ]);
    await useGameDataStore.getState().loadInitializers();
    expect(mocked.getInitializers).toHaveBeenCalledTimes(1);
    expect(useGameDataStore.getState().initializers).toEqual(INITIALIZERS);

    await useGameDataStore.getState().unload();
    expect(useGameDataStore.getState().initializers).toBeNull();
  });

  it("a scenario reads them as it loads, keeping each initializer's star class for the map", async () => {
    mocked.getInitializers.mockResolvedValue(INITIALIZERS);
    useFileSessionStore.setState({ kind: "scenario" });
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    await useGameDataStore.getState().load();
    await vi.waitFor(() => expect(useGameDataStore.getState().initializers).toEqual(INITIALIZERS));
    const classes = useGameDataStore.getState().initializerClasses;
    expect([...classes]).toEqual([["hole_init", "sc_black_hole"]]);

    await useGameDataStore.getState().unload();
    expect(useGameDataStore.getState().initializerClasses.size).toBe(0);
  });

  it("another install reads them again", async () => {
    mocked.getInitializers.mockResolvedValue(INITIALIZERS);
    await useGameDataStore.getState().load();
    await useGameDataStore.getState().loadInitializers();

    await useGameDataStore.getState().load("D:/Other/Stellaris");
    expect(useGameDataStore.getState().initializers).toBeNull();
    await useGameDataStore.getState().loadInitializers();
    expect(mocked.getInitializers).toHaveBeenCalledTimes(2);
  });
});

describe("unload", () => {
  it("resets to idle and re-classifies the open save without game data", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    await useGameDataStore.getState().load();
    mocked.getSpecialSystems.mockClear();
    mocked.getSpecialSystems.mockResolvedValueOnce({ ...SPECIAL, with_game_data: false });

    await useGameDataStore.getState().unload();

    const state = useGameDataStore.getState();
    expect(mocked.unloadGameData).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("idle");
    expect(state.summary).toBeNull();
    expect(state.names.size).toBe(0);
    expect(state.starClasses.size).toBe(0);
    expect(state.deposits.size).toBe(0);
    expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1);
    expect(state.specialWithGameData).toBe(false);
    expect(state.special.size).toBe(1);
  });
});

describe("save hooks", () => {
  it("onSaveOpened classifies the save and fetches its names when ready", async () => {
    await useGameDataStore.getState().load();
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    useDetailsStore.setState({ version: 0 });

    useGameDataStore.getState().onSaveOpened();
    await vi.waitFor(() => expect(useGameDataStore.getState().special.size).toBe(1));
    await vi.waitFor(() => expect(mocked.getNames).toHaveBeenCalledWith(GALAXY_KEYS));
    expect(useDetailsStore.getState().version).toBe(1);
  });

  it("onSaveOpened resolves each country's name template and keeps the key fetch to systems and nebulae", async () => {
    await useGameDataStore.getState().load();
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, countries: [RIHINAR] });

    useGameDataStore.getState().onSaveOpened();
    await vi.waitFor(() => expect(mocked.resolveNames).toHaveBeenCalledWith([RIHINAR.name]));
    expect(mocked.getNames).toHaveBeenLastCalledWith(GALAXY_KEYS);
    expect(useGameDataStore.getState().names.get(templateKey(RIHINAR.name))).toBe(
      "SPEC_RihiNar Sovereignty",
    );
  });

  it("onSaveOpened without game data only classifies by flags", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    useGameDataStore.getState().onSaveOpened();
    await vi.waitFor(() => expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1));
    expect(mocked.getNames).not.toHaveBeenCalled();
  });

  it("onSaveOpened resolves once the owners pass settles, and settles even when it fails", async () => {
    await useGameDataStore.getState().load();
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    let resolveOwners!: (owners: ScenarioOwners | null) => void;
    mocked.getScenarioOwners.mockImplementationOnce(
      () => new Promise<ScenarioOwners | null>((resolve) => (resolveOwners = resolve)),
    );

    let settled = false;
    const p = useGameDataStore
      .getState()
      .onSaveOpened()
      .then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);

    resolveOwners(null);
    await p;
    expect(settled).toBe(true);

    mocked.getScenarioOwners.mockRejectedValueOnce({ kind: "ipc", message: "boom" });
    await expect(useGameDataStore.getState().onSaveOpened()).resolves.toBeUndefined();
  });

  it("onSaveClosed drops the special systems and keeps the game data", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    await useGameDataStore.getState().load();
    expect(useGameDataStore.getState().special.size).toBe(1);

    useGameDataStore.getState().onSaveClosed();
    const state = useGameDataStore.getState();
    expect(state.special.size).toBe(0);
    expect(state.counts).toEqual([]);
    expect(state.status).toBe("ready");
    expect(state.names.size).toBeGreaterThan(0);
  });
});

describe("scenario owners", () => {
  it("hands the scripted ownership to the galaxy and takes it back on unload", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    mocked.getScenarioOwners.mockResolvedValue(SCENARIO_OWNERS);

    await useGameDataStore.getState().load();

    expect(useGameDataStore.getState().scenarioOwners).toBe(SCENARIO_OWNERS);
    expect(useGameDataStore.getState().scenarioOwnersPending).toBe(false);
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBe(TERRITORY.id);
    expect(useGalaxyStore.getState().systems.get(2)?.owner).toBe(TERRITORY.id);
    expect(useGalaxyStore.getState().countries.get(TERRITORY.id)).toBe(TERRITORY);

    mocked.getScenarioOwners.mockResolvedValue(null);
    await useGameDataStore.getState().unload();

    expect(useGameDataStore.getState().scenarioOwners).toBeNull();
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBeNull();
    expect(useGalaxyStore.getState().countries.size).toBe(0);
  });

  it("reads the bypasses with the owners and drops them with the game data", async () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    mocked.getScenarioOwners.mockResolvedValue(SCENARIO_OWNERS);
    mocked.getScenarioBypasses.mockResolvedValue(SCENARIO_BYPASSES);

    await useGameDataStore.getState().load();

    expect(useGameDataStore.getState().scenarioBypasses).toBe(SCENARIO_BYPASSES);

    mocked.getScenarioOwners.mockResolvedValue(null);
    mocked.getScenarioBypasses.mockResolvedValue(null);
    await useGameDataStore.getState().unload();

    expect(useGameDataStore.getState().scenarioBypasses).toBeNull();
  });

  it("reads them again when a document opens, and asks for nothing without one", async () => {
    mocked.getScenarioOwners.mockResolvedValue(SCENARIO_OWNERS);
    await useGameDataStore.getState().load();
    expect(mocked.getScenarioOwners).not.toHaveBeenCalled();

    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    useGameDataStore.getState().onSaveOpened();

    await vi.waitFor(() =>
      expect(useGameDataStore.getState().scenarioOwners).toBe(SCENARIO_OWNERS),
    );
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBe(TERRITORY.id);
  });
});
