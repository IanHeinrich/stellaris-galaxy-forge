import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/gamedata", () => import("../test/textures"));

import type { ModelUse } from "../generated/ModelUse";
import { clearTextures } from "../lib/visual/textures";
import { megastructureTypeView, planetClassView, starbaseLevelView } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { getTextures, resetTextureFetch, textureFetch } from "../test/textures";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import {
  followModelPrewarm,
  PREWARM_BATCH,
  PREWARM_DELAY_MS,
  resetModelPrewarm,
} from "./modelPrewarm";
import { resetStores } from "./storeFixture";

const RUIN = megastructureTypeView("ring_world_ruined");
const PORT = starbaseLevelView("starbase_level_starport", {
  station_entity: "starbase_starport_section_entity",
});
const HABITAT = planetClassView("pc_habitat", false, null, {
  body_model: "orbital_habitat_01_entity",
});
const SEGMENT = planetClassView("pc_ringworld_tech", false, null, {
  ringworld: true,
  body_model: "ringworld_tech_entity_01_entity",
});

const USES: ModelUse[] = [
  { kind: "megastructure", key: RUIN.key, culture: "avian_01", entity: null, at: [-45.2, 0] },
  { kind: "megastructure", key: RUIN.key, culture: "avian_01", entity: null, at: [-45.2, 0] },
  { kind: "megastructure", key: "giga_unknown", culture: null, entity: null, at: [3, 4] },
  { kind: "megastructure", key: RUIN.key, culture: "lithoid_01", entity: null, at: null },
  { kind: "starbase", key: PORT.key, culture: "humanoid_01", entity: null, at: [10, 0] },
  {
    kind: "planet",
    key: HABITAT.key,
    culture: "avian_01",
    entity: "avian_01_habitat_phase_03_entity",
    at: [12, 7],
  },
  { kind: "planet", key: SEGMENT.key, culture: null, entity: null, at: [0, 45] },
  { kind: "planet", key: "pc_continental", culture: null, entity: null, at: [60, 0] },
];

/** The models the system view draws for `USES`, as it chooses their keys. */
const KEYS = [
  "model:avian_01:ring_world_ruined_entity:yaw180",
  "model:humanoid_01:starbase_starport_section_entity",
  "model:avian_01:avian_01_habitat_phase_03_entity",
  "model:mammalian_01:ringworld_tech_entity_01_entity:yaw270",
];

function gameData(version: number): void {
  useGameDataStore.setState({
    status: "ready",
    version,
    megastructureTypes: new Map([[RUIN.key, RUIN]]),
    starbaseLevels: new Map([[PORT.key, PORT]]),
    planetClasses: new Map(
      [HABITAT, SEGMENT, planetClassView("pc_continental", false)].map((c) => [c.key, c]),
    ),
  });
}

function open(path: string): void {
  useFileSessionStore.setState({ status: "ready", kind: "save", path });
}

const asked = () => getTextures.mock.calls.flatMap(([keys]) => keys);

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  resetModelPrewarm();
  clearTextures();
  getTextures.mockClear();
  textureFetch.mode = "views";
  mockedIpc.getModelUses.mockResolvedValue(USES);
  followModelPrewarm();
});

afterEach(() => {
  resetModelPrewarm();
  resetTextureFetch();
  vi.useRealTimers();
});

describe("baking a save's models before a system is opened", () => {
  it("asks for each model the system view draws, once, after the galaxy map has had its turn", async () => {
    gameData(1);
    open("a.sav");
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS - 10);
    expect(mockedIpc.getModelUses).not.toHaveBeenCalled();
    expect(getTextures).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(asked()).toEqual(KEYS);
  });

  it("waits for the game data, and warms a save again only when it or the game data changes", async () => {
    open("a.sav");
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedIpc.getModelUses).not.toHaveBeenCalled();

    gameData(1);
    await vi.advanceTimersByTimeAsync(5000);
    useFileSessionStore.setState({ status: "ready" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedIpc.getModelUses).toHaveBeenCalledTimes(1);

    clearTextures();
    gameData(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedIpc.getModelUses).toHaveBeenCalledTimes(2);
    expect(asked()).toEqual([...KEYS, ...KEYS]);
  });

  it("stops warming a save that is closed before its turn comes", async () => {
    gameData(1);
    open("a.sav");
    useFileSessionStore.setState({ status: "empty", path: null, kind: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedIpc.getModelUses).not.toHaveBeenCalled();
  });

  it("waits for the game data's registries, which land after it reports ready", async () => {
    useGameDataStore.setState({ status: "ready", version: 1, planetClasses: new Map() });
    open("a.sav");
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedIpc.getModelUses).not.toHaveBeenCalled();

    gameData(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked()).toEqual(KEYS);
  });

  it("goes on to the next batch when the cache is cleared under the one in flight", async () => {
    const stations: ModelUse[] = Array.from({ length: PREWARM_BATCH + 2 }, (_, i) => ({
      kind: "starbase",
      key: PORT.key,
      culture: `culture_${i}`,
      entity: null,
      at: null,
    }));
    mockedIpc.getModelUses.mockResolvedValue(stations);
    textureFetch.mode = "never";
    gameData(1);
    open("a.sav");
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS + 10);
    expect(getTextures).toHaveBeenCalledTimes(1);

    clearTextures();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getTextures).toHaveBeenCalledTimes(2);
    expect(getTextures.mock.calls[1][0]).toHaveLength(2);
  });
});
