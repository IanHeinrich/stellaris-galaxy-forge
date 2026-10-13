import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import { useGameDataStore } from "./gameDataStore";
import { resetStores } from "./storeFixture";

/** Each test reads from game data of its own, so nothing one asked for stays asked in the next. */
let loads = 0;

beforeEach(() => {
  resetStores();
  mockedIpc.getGameTexts.mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.filter((k) => k !== "NOPE").map((k) => [k, `§Y${k}§!`])),
  );
  useGameDataStore.setState({ status: "ready", version: ++loads });
});

describe("game texts", () => {
  it("fetches each key once and keeps its markup", async () => {
    await useGameDataStore.getState().fetchTexts(["A", "B", "A"]);
    await useGameDataStore.getState().fetchTexts(["A", "C"]);
    expect(mockedIpc.getGameTexts.mock.calls).toEqual([[["A", "B"]], [["C"]]]);
    expect(useGameDataStore.getState().texts.get("B")).toBe("§YB§!");
  });

  it("caches a key the install has no text for as empty, and does not ask again", async () => {
    await useGameDataStore.getState().fetchTexts(["NOPE"]);
    await useGameDataStore.getState().fetchTexts(["NOPE"]);
    expect(mockedIpc.getGameTexts).toHaveBeenCalledTimes(1);
    expect(useGameDataStore.getState().texts.get("NOPE")).toBe("");
  });

  it("asks again for a key whose read failed", async () => {
    mockedIpc.getGameTexts.mockRejectedValueOnce({ kind: "io", message: "busy" });
    await useGameDataStore.getState().fetchTexts(["A"]);
    expect(useGameDataStore.getState().error).toBe("busy");
    await useGameDataStore.getState().fetchTexts(["A"]);
    expect(useGameDataStore.getState().texts.get("A")).toBe("§YA§!");
  });

  it("asks for nothing without game data", async () => {
    useGameDataStore.setState({ status: "idle" });
    await useGameDataStore.getState().fetchTexts(["A"]);
    expect(mockedIpc.getGameTexts).not.toHaveBeenCalled();
  });
});
