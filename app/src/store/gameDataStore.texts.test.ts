import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { setGameTextSource, useGameDataStore } from "./gameDataStore";
import { resetStores } from "./storeFixture";

const source = vi.fn(async (keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k !== "NOPE").map((k) => [k, `§Y${k}§!`])),
);

beforeEach(() => {
  resetStores();
  source.mockClear();
  setGameTextSource(source);
  useGameDataStore.setState({ status: "ready" });
});

describe("game texts", () => {
  it("fetches each key once and keeps its markup", async () => {
    await useGameDataStore.getState().fetchTexts(["A", "B", "A"]);
    await useGameDataStore.getState().fetchTexts(["A", "C"]);
    expect(source.mock.calls).toEqual([[["A", "B"]], [["C"]]]);
    expect(useGameDataStore.getState().texts.get("B")).toBe("§YB§!");
  });

  it("caches a key the install has no text for as empty, and does not ask again", async () => {
    await useGameDataStore.getState().fetchTexts(["NOPE"]);
    await useGameDataStore.getState().fetchTexts(["NOPE"]);
    expect(source).toHaveBeenCalledTimes(1);
    expect(useGameDataStore.getState().texts.get("NOPE")).toBe("");
  });

  it("asks for nothing without game data", async () => {
    useGameDataStore.setState({ status: "idle" });
    await useGameDataStore.getState().fetchTexts(["A"]);
    expect(source).not.toHaveBeenCalled();
  });
});
