import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDataSummary } from "../generated/GameDataSummary";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("../lib/visual/textures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/visual/textures")>();
  return { ...actual, clearTextures: vi.fn() };
});

import * as ipc from "../api/ipc";
import { useGameDataStore } from "./gameDataStore";
import { armGameData, listeners, mocked, releaseGameData, SUMMARY } from "./gameDataFixture";

beforeEach(armGameData);
afterEach(releaseGameData);

describe("launch", () => {
  beforeEach(() => {
    vi.mocked(ipc.gameDataSummary).mockResolvedValue(null);
  });

  it("stops on the setup card until the preference is answered", async () => {
    await useGameDataStore.getState().start();
    expect(useGameDataStore.getState().startup).toBe("setup");
    expect(useGameDataStore.getState().autoLoad).toBe("ask");
    expect(useGameDataStore.getState().startupLoad).toBe(false);
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("adopts game data the backend already holds before showing the setup card", async () => {
    vi.mocked(ipc.gameDataSummary).mockResolvedValue(SUMMARY);
    await useGameDataStore.getState().start();
    const state = useGameDataStore.getState();
    expect(state.startup).toBe("setup");
    expect(state.status).toBe("ready");
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("continuing with data already held loads nothing again", async () => {
    vi.mocked(ipc.gameDataSummary).mockResolvedValue(SUMMARY);
    await useGameDataStore.getState().start();
    await useGameDataStore.getState().continueSetup(true);
    expect(listeners.storage.get("sgf.gameData.autoLoad")).toBe('"on"');
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("continuing with the box ticked stores the preference and loads without the start screen", async () => {
    await useGameDataStore.getState().continueSetup(true);
    expect(listeners.storage.get("sgf.gameData.autoLoad")).toBe('"on"');
    expect(useGameDataStore.getState().startup).toBe("ready");
    expect(useGameDataStore.getState().startupLoad).toBe(false);
    expect(mocked.loadGameData).toHaveBeenCalledTimes(1);
    expect(useGameDataStore.getState().status).toBe("ready");
  });

  it("continuing with the box cleared stores the preference and loads nothing", async () => {
    await useGameDataStore.getState().continueSetup(false);
    expect(listeners.storage.get("sgf.gameData.autoLoad")).toBe('"off"');
    expect(useGameDataStore.getState().startup).toBe("ready");
    expect(mocked.loadGameData).not.toHaveBeenCalled();
    expect(useGameDataStore.getState().status).toBe("idle");
  });

  it("a later launch with the preference on loads the game data behind the start screen", async () => {
    listeners.storage.set("sgf.gameData.autoLoad", '"on"');
    let finish: (summary: GameDataSummary) => void = () => {};
    mocked.loadGameData.mockImplementationOnce(
      () =>
        new Promise<GameDataSummary>((resolve) => {
          finish = resolve;
        }),
    );

    const started = useGameDataStore.getState().start();
    await vi.waitFor(() => expect(useGameDataStore.getState().status).toBe("loading"));
    expect(useGameDataStore.getState().startupLoad).toBe(true);
    expect(useGameDataStore.getState().startup).toBe("ready");
    finish(SUMMARY);
    await started;
    const state = useGameDataStore.getState();
    expect(state.autoLoad).toBe("on");
    expect(state.startupLoad).toBe(false);
    expect(mocked.loadGameData).toHaveBeenCalledTimes(1);
  });

  it("a later launch with the preference off loads nothing", async () => {
    listeners.storage.set("sgf.gameData.autoLoad", '"off"');
    await useGameDataStore.getState().start();
    expect(useGameDataStore.getState().startup).toBe("ready");
    expect(useGameDataStore.getState().autoLoad).toBe("off");
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("game data the backend already holds is adopted instead of loaded again", async () => {
    listeners.storage.set("sgf.gameData.autoLoad", '"on"');
    vi.mocked(ipc.gameDataSummary).mockResolvedValue(SUMMARY);
    await useGameDataStore.getState().start();
    expect(useGameDataStore.getState().status).toBe("ready");
    expect(useGameDataStore.getState().startupLoad).toBe(false);
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("a malformed stored preference falls back to the setup card", async () => {
    listeners.storage.set("sgf.gameData.autoLoad", "nonsense");
    await useGameDataStore.getState().start();
    expect(useGameDataStore.getState().startup).toBe("setup");
  });

  it("setAutoLoad stores the choice without touching the load", async () => {
    useGameDataStore.getState().setAutoLoad("on");
    expect(listeners.storage.get("sgf.gameData.autoLoad")).toBe('"on"');
    expect(useGameDataStore.getState().autoLoad).toBe("on");
    expect(mocked.loadGameData).not.toHaveBeenCalled();
  });

  it("an install chosen on the setup card is remembered and used by the load", async () => {
    useGameDataStore.getState().setInstallPath("D:/Games/Stellaris");
    expect(useGameDataStore.getState().installPath).toBe("D:/Games/Stellaris");
    expect(listeners.storage.get("sgf.installPath")).toBe("D:/Games/Stellaris");
    await useGameDataStore.getState().load();
    expect(mocked.loadGameData).toHaveBeenCalledWith("D:/Games/Stellaris");
  });
});
