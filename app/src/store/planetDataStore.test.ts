import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("../lib/visual/textures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/visual/textures")>();
  return { ...actual, clearTextures: vi.fn() };
});

import * as ipc from "../api/ipc";
import { depositTypeView } from "./fixture";
import { armGameData, flush, releaseGameData } from "./gameDataFixture";
import { useGameDataStore } from "./gameDataStore";
import { usePlanetDataStore } from "./planetDataStore";

const getDepositTypes = vi.mocked(ipc.getDepositTypes);
const planetData = () => usePlanetDataStore.getState();
const GLACIER = ["d_massive_glacier"];
const keys = (deposits: string[]) => ({ deposits, modifiers: [], colonyTypes: [] });

beforeEach(async () => {
  armGameData();
  await useGameDataStore.getState().load();
  getDepositTypes.mockImplementation(async (keys) => keys.map((key) => depositTypeView(key)));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  releaseGameData();
  vi.restoreAllMocks();
});

describe("the planet page's game data", () => {
  it("asks once for a key, and again after a read of it failed", async () => {
    getDepositTypes.mockRejectedValueOnce({ kind: "internal", message: "read failed" });
    planetData().request(keys(GLACIER));
    await flush();
    expect(planetData().depositTypes.size).toBe(0);
    expect(useGameDataStore.getState().error).toBeNull();

    planetData().request(keys(GLACIER));
    await flush();
    expect(planetData().depositTypes.has("d_massive_glacier")).toBe(true);

    planetData().request(keys(GLACIER));
    expect(getDepositTypes).toHaveBeenCalledTimes(2);
  });

  it("forgets what it read when the game data reloads, and asks again", async () => {
    planetData().request(keys(GLACIER));
    await flush();
    const before = planetData().generation;

    await useGameDataStore.getState().load();
    expect(planetData().depositTypes.size).toBe(0);
    expect(planetData().generation).toBeGreaterThan(before);

    planetData().request(keys(GLACIER));
    await flush();
    expect(planetData().depositTypes.has("d_massive_glacier")).toBe(true);
    expect(getDepositTypes).toHaveBeenCalledTimes(2);
  });

  it("asks nothing without game data", async () => {
    await useGameDataStore.getState().unload();
    planetData().request(keys(GLACIER));
    expect(getDepositTypes).not.toHaveBeenCalled();
  });
});
