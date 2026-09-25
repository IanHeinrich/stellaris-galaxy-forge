import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { PickSummary } from "../generated/PickSummary";
import { mocked, openFixtureSave } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { loadGameData } from "./gameDataFixture";
import { useGeneratorStore } from "./generatorStore";

const getAddSystemPicks = mocked.getAddSystemPicks;

beforeEach(async () => {
  await openFixtureSave();
  await loadGameData();
});

describe("the Add system menu's picks", () => {
  const summary = (planets: number): PickSummary => ({
    star_classes: [],
    star_description: null,
    planets: { min: planets, max: planets },
    max_moons: 0,
    moons: "never",
    belts: { min: 0, max: 0 },
    belt_kinds: [],
    asteroids: { min: 0, max: 0 },
    named_bodies: [],
    notable_classes: [],
    modifiers: [],
    rings: "never",
    dlc: null,
    max_instances: null,
    in_galaxy: null,
  });
  const picks = (planets: number): AddSystemPicks => ({
    random: summary(planets),
    star_classes: [],
    special: [],
  });

  it("are read again each time, keeping the last ones until the next land, and drop a late answer", async () => {
    let answerSecond!: (value: AddSystemPicks) => void;
    getAddSystemPicks
      .mockResolvedValueOnce(picks(1))
      .mockReturnValueOnce(new Promise<AddSystemPicks>((r) => (answerSecond = r)))
      .mockResolvedValueOnce(picks(3));
    const generator = () => useGeneratorStore.getState();

    generator().refreshPicks();
    await vi.waitFor(() => expect(generator().picks?.random.planets.max).toBe(1));
    generator().refreshPicks();
    await Promise.resolve();
    expect(generator().picks?.random.planets.max).toBe(1);
    generator().refreshPicks();
    await vi.waitFor(() => expect(generator().picks?.random.planets.max).toBe(3));
    answerSecond(picks(2));
    await Promise.resolve();

    expect(generator().picks?.random.planets.max).toBe(3);
  });

  it("are forgotten when the document closes", async () => {
    getAddSystemPicks.mockResolvedValueOnce(picks(1));
    useGeneratorStore.getState().refreshPicks();
    await vi.waitFor(() => expect(useGeneratorStore.getState().picks).not.toBeNull());

    await useFileSessionStore.getState().close();

    expect(useGeneratorStore.getState().picks).toBeNull();
  });
});
