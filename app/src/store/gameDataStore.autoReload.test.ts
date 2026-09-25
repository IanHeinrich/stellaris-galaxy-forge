import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDataChanged } from "../generated/GameDataChanged";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { SpecialSystems } from "../generated/SpecialSystems";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("../lib/visual/textures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/visual/textures")>();
  return { ...actual, clearTextures: vi.fn() };
});

import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import {
  armGameData,
  flush,
  GALAXY_KEYS,
  listeners,
  mocked,
  releaseGameData,
  SPECIAL,
  SUMMARY,
} from "./gameDataFixture";
import { OPEN_RESULT, SCENARIO_OWNERS } from "./fixture";

beforeEach(armGameData);
afterEach(releaseGameData);

describe("auto-reload", () => {
  const CHANGED: GameDataChanged = {
    registries: ["localisation"],
    version: 2,
    watch: { watching: 3, paused: false, reason: null },
    hot_file: null,
    hot_count: 0,
  };

  /** The subscription outlives a test, so each one starts without game data and so without it. */
  beforeEach(async () => {
    await useGameDataStore.getState().unload();
    vi.clearAllMocks();
  });

  /** The store subscribes once it holds game data; the watcher speaks through that handler. */
  async function ready(): Promise<(c: GameDataChanged) => void> {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    await useGameDataStore.getState().load();
    await vi.waitFor(() => expect(listeners.changed).not.toBeNull());
    vi.clearAllMocks();
    return listeners.changed!;
  }

  it("takes the generation and the roots under watch from the summary a sync adopts", async () => {
    mocked.gameDataSummary.mockResolvedValue({
      ...SUMMARY,
      generation: 4,
      watch: { watching: 2, paused: false, reason: null },
    });
    await useGameDataStore.getState().sync();
    expect(useGameDataStore.getState().version).toBe(4);
    expect(useGameDataStore.getState().watching).toBe(2);
  });

  it("a rebuilt registry re-reads everything the load read, and leaves the textures alone", async () => {
    const changed = await ready();
    mocked.gameDataSummary.mockResolvedValue({ ...SUMMARY, generation: 2 });

    changed(CHANGED);

    await vi.waitFor(() => expect(mocked.getNames).toHaveBeenCalledWith(GALAXY_KEYS));
    const state = useGameDataStore.getState();
    expect(state.version).toBe(2);
    expect(state.watching).toBe(3);
    expect(state.autoReloadPaused).toBe(false);
    expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1);
    expect(mocked.getStarClasses).toHaveBeenCalledTimes(1);
    expect(mocked.getScenarioOwners).toHaveBeenCalledTimes(1);
    expect(mocked.clearTextures).not.toHaveBeenCalled();
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("subscribes once and drops the subscription with the game data", async () => {
    await ready();
    await useGameDataStore.getState().load();
    expect(mocked.onGameDataChanged).not.toHaveBeenCalled();

    await useGameDataStore.getState().unload();
    expect(listeners.unlistenChanges).toHaveBeenCalledTimes(1);
    expect(useGameDataStore.getState().version).toBe(0);
    expect(useGameDataStore.getState().watching).toBe(0);
  });

  it("a tail still running when the game data goes away writes nothing more", async () => {
    const changed = await ready();
    mocked.gameDataSummary.mockResolvedValue({ ...SUMMARY, generation: 2 });
    let answer: (owners: ScenarioOwners | null) => void = () => {};
    mocked.getScenarioOwners.mockImplementationOnce(
      () =>
        new Promise<ScenarioOwners | null>((resolve) => {
          answer = resolve;
        }),
    );

    changed(CHANGED);
    await vi.waitFor(() => expect(mocked.getScenarioOwners).toHaveBeenCalledTimes(1));

    mocked.getScenarioOwners.mockResolvedValue(null);
    await useGameDataStore.getState().unload();
    answer(SCENARIO_OWNERS);
    await flush();

    expect(useGameDataStore.getState().status).toBe("idle");
    expect(useGameDataStore.getState().scenarioOwners).toBeNull();
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBeNull();
    expect(useGalaxyStore.getState().countries.size).toBe(0);
    expect(mocked.getNames).not.toHaveBeenCalled();
  });

  it("a second rebuild supersedes the first, whose answer no longer counts", async () => {
    const changed = await ready();
    let answer: (summary: GameDataSummary) => void = () => {};
    mocked.gameDataSummary
      .mockImplementationOnce(
        () =>
          new Promise<GameDataSummary>((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValue({ ...SUMMARY, generation: 3 });

    changed({ ...CHANGED, version: 2 });
    await vi.waitFor(() => expect(mocked.gameDataSummary).toHaveBeenCalledTimes(1));
    changed({ ...CHANGED, version: 3 });
    await vi.waitFor(() => expect(mocked.getNames).toHaveBeenCalledWith(GALAXY_KEYS));

    mocked.getStarClasses.mockClear();
    answer({ ...SUMMARY, generation: 2 });
    await flush();

    expect(useGameDataStore.getState().version).toBe(3);
    expect(useGameDataStore.getState().summary?.generation).toBe(3);
    expect(mocked.getStarClasses).not.toHaveBeenCalled();
  });

  it("an abandoned tail leaves no spinner behind", async () => {
    const changed = await ready();
    mocked.gameDataSummary.mockResolvedValue({ ...SUMMARY, generation: 2 });
    let answer: (systems: SpecialSystems) => void = () => {};
    mocked.getSpecialSystems.mockImplementationOnce(
      () =>
        new Promise<SpecialSystems>((resolve) => {
          answer = resolve;
        }),
    );

    changed(CHANGED);
    await vi.waitFor(() => expect(useGameDataStore.getState().specialPending).toBe(true));

    mocked.loadGameData.mockRejectedValueOnce({ kind: "no_install", message: "nope" });
    await useGameDataStore.getState().load();
    answer(SPECIAL);
    await flush();

    expect(useGameDataStore.getState().status).toBe("error");
    expect(useGameDataStore.getState().specialPending).toBe(false);
  });

  it("the load's own tail stops writing once the game data is unloaded", async () => {
    await ready();
    let answer: (owners: ScenarioOwners | null) => void = () => {};
    mocked.getScenarioOwners.mockImplementationOnce(
      () =>
        new Promise<ScenarioOwners | null>((resolve) => {
          answer = resolve;
        }),
    );

    const loading = useGameDataStore.getState().load();
    await vi.waitFor(() => expect(useGameDataStore.getState().scenarioOwnersPending).toBe(true));

    mocked.getScenarioOwners.mockResolvedValue(null);
    await useGameDataStore.getState().unload();
    answer(SCENARIO_OWNERS);
    await loading;
    await flush();

    expect(useGameDataStore.getState().scenarioOwners).toBeNull();
    expect(useGameDataStore.getState().scenarioOwnersPending).toBe(false);
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBeNull();
    expect(useGalaxyStore.getState().countries.size).toBe(0);
  });

  it("a page reload adopts a watcher the breaker had already paused", async () => {
    mocked.gameDataSummary.mockResolvedValue({
      ...SUMMARY,
      watch: { watching: 2, paused: true, reason: null },
    });
    await useGameDataStore.getState().sync();
    expect(useGameDataStore.getState().autoReloadPaused).toBe(true);
    expect(useGameDataStore.getState().hotFile).toBeNull();
  });

  it("carries the watcher's reason from the summary a load takes", async () => {
    mocked.loadGameData.mockResolvedValueOnce({
      ...SUMMARY,
      generation: 1,
      watch: { watching: 1, paused: false, reason: "could not watch C:/mods/gone: not found" },
    });
    await useGameDataStore.getState().load();

    const state = useGameDataStore.getState();
    expect(state.watching).toBe(1);
    expect(state.watchReason).toBe("could not watch C:/mods/gone: not found");
    expect(state.summary?.watch.reason).toBe("could not watch C:/mods/gone: not found");
  });

  it("an event no newer than what the store has seen is a duplicate", async () => {
    const changed = await ready();
    mocked.gameDataSummary.mockResolvedValue({ ...SUMMARY, generation: 2 });

    changed(CHANGED);
    await vi.waitFor(() => expect(mocked.getStarClasses).toHaveBeenCalledTimes(1));

    vi.clearAllMocks();
    changed(CHANGED);
    await flush();
    expect(mocked.gameDataSummary).not.toHaveBeenCalled();
    expect(mocked.getStarClasses).not.toHaveBeenCalled();
    expect(useGameDataStore.getState().version).toBe(2);
  });

  it("a subscription the bridge refused is not held, and the unload still runs", async () => {
    mocked.onGameDataChanged.mockRejectedValueOnce({ kind: "ipc", message: "the bridge is gone" });
    await useGameDataStore.getState().load();
    await vi.waitFor(() => expect(useGameDataStore.getState().error).toBe("the bridge is gone"));

    await useGameDataStore.getState().unload();
    expect(mocked.unloadGameData).toHaveBeenCalledTimes(1);
    expect(useGameDataStore.getState().status).toBe("idle");
    expect(useGameDataStore.getState().error).toBeNull();
  });

  it("a pause names the hot file and asks for nothing; resuming clears it", async () => {
    const changed = await ready();

    changed({
      registries: [],
      version: 2,
      watch: { watching: 3, paused: true, reason: null },
      hot_file: "C:/mods/1/common/country_types/00_country_types.txt",
      hot_count: 10,
    });

    const paused = useGameDataStore.getState();
    expect(paused.autoReloadPaused).toBe(true);
    expect(paused.hotFile).toBe("C:/mods/1/common/country_types/00_country_types.txt");
    expect(paused.hotCount).toBe(10);
    expect(mocked.getStarClasses).not.toHaveBeenCalled();

    await useGameDataStore.getState().resumeAutoReload();
    expect(mocked.resumeAutoReload).toHaveBeenCalledTimes(1);

    changed({
      registries: [],
      version: 2,
      watch: { watching: 3, paused: false, reason: null },
      hot_file: null,
      hot_count: 0,
    });
    expect(useGameDataStore.getState().autoReloadPaused).toBe(false);
    expect(useGameDataStore.getState().hotFile).toBeNull();
    expect(useGameDataStore.getState().hotCount).toBe(0);
  });
});
