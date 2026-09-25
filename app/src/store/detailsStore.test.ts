import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemDetails } from "../generated/SystemDetails";

vi.mock("../api/ipc");

const fetchNames = vi.fn(async () => {});
vi.mock("./gameDataStore", () => ({
  useGameDataStore: {
    getState: () => ({ fetchNames, status: "ready", names: new Map() }),
    subscribe: () => () => undefined,
  },
}));

import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useDetailsStore } from "./detailsStore";
import { planetSummary, systemDetails } from "./fixture";

bindStores();

const getSystemDetails = vi.mocked(ipc.getSystemDetails);
const getResourceIcons = vi.mocked(ipc.getResourceIcons);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useDetailsStore.getState().clear();
  getSystemDetails.mockImplementation(async (ids) => ids.map((id) => systemDetails({ id })));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("request", () => {
  it("coalesces requests made within the debounce into one call and caches the results", async () => {
    const before = useDetailsStore.getState().version;
    useDetailsStore.getState().request([1, 2, 3]);
    vi.advanceTimersByTime(50);
    useDetailsStore.getState().request([3, 4]);
    expect(getSystemDetails).not.toHaveBeenCalled();
    expect([...useDetailsStore.getState().pending]).toEqual([1, 2, 3, 4]);

    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenCalledTimes(1);
    expect(getSystemDetails).toHaveBeenCalledWith([1, 2, 3, 4]);

    const state = useDetailsStore.getState();
    expect([...state.details.keys()]).toEqual([1, 2, 3, 4]);
    expect(state.pending.size).toBe(0);
    expect(state.version).toBe(before + 1);
  });

  it("does not re-request known ids", async () => {
    useDetailsStore.getState().request([1, 2]);
    await vi.advanceTimersByTimeAsync(100);
    useDetailsStore.getState().request([1, 2, 3]);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenCalledTimes(2);
    expect(getSystemDetails).toHaveBeenLastCalledWith([3]);
  });

  it("splits a large queue into batches of at most 200", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    useDetailsStore.getState().request(ids);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenCalledTimes(3);
    expect(getSystemDetails.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 50]);
    expect(useDetailsStore.getState().details.size).toBe(450);
  });

  it("a rejected call reports the failure per id, and asks again once an edit invalidates it", async () => {
    getSystemDetails.mockRejectedValueOnce({ kind: "no_session", message: "nothing open" });
    const before = useDetailsStore.getState().version;
    useDetailsStore.getState().request([7, 8]);
    await vi.advanceTimersByTimeAsync(100);

    let state = useDetailsStore.getState();
    expect(state.pending.size).toBe(0);
    expect(state.details.size).toBe(0);
    expect(state.failed.get(7)).toBe("nothing open");
    expect(state.failed.get(8)).toBe("nothing open");
    expect(state.version).toBe(before + 1);

    // The failure is on screen, and the view re-requests on every version bump: asking again now
    // would ask forever.
    useDetailsStore.getState().request([7, 8]);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenCalledTimes(1);

    useDetailsStore.getState().invalidate([7, 8]);
    expect(useDetailsStore.getState().failed.size).toBe(0);
    useDetailsStore.getState().request([7, 8]);
    await vi.advanceTimersByTimeAsync(100);

    expect(getSystemDetails).toHaveBeenCalledTimes(2);
    state = useDetailsStore.getState();
    expect(state.details.size).toBe(2);
    expect(state.failed.size).toBe(0);
  });

  it("clears a recorded failure once a later answer brings those details", async () => {
    let fail!: (e: unknown) => void;
    let finish!: (d: SystemDetails[]) => void;
    getSystemDetails.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    getSystemDetails.mockReturnValueOnce(new Promise((r) => (finish = r)));

    useDetailsStore.getState().request([7, 8]);
    await vi.advanceTimersByTimeAsync(100);
    useDetailsStore.getState().invalidate([7, 8]);
    useDetailsStore.getState().request([7, 8]);
    await vi.advanceTimersByTimeAsync(100);

    fail({ kind: "no_session", message: "nothing open" });
    await vi.advanceTimersByTimeAsync(0);
    expect(useDetailsStore.getState().failed.get(7)).toBe("nothing open");

    finish([systemDetails({ id: 7 }), systemDetails({ id: 8 })]);
    await vi.advanceTimersByTimeAsync(0);
    const state = useDetailsStore.getState();
    expect(state.details.size).toBe(2);
    expect(state.failed.size).toBe(0);
  });

  it("asks for the localisation of what the answered details will show", async () => {
    getSystemDetails.mockImplementationOnce(async (ids) =>
      ids.map((id) => ({
        ...systemDetails({ id }),
        planets: [
          planetSummary({
            name: {
              key: "PLANET_NAME_FORMAT",
              literal: false,
              variables: [
                { name: "NAME", value: { key: "NAME_Alpha", literal: false, variables: [] } },
              ],
            },
            name_key: "NAME_Alpha",
            habitable: true,
            size: 12,
          }),
        ],
        resources: [{ resource: "energy", amount: 3 }],
      })),
    );
    useDetailsStore.getState().request([1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchNames).toHaveBeenCalledWith(["PLANET_NAME_FORMAT", "NAME", "NAME_Alpha", "energy"]);
  });

  it("skips ids the Rust side does not know and does not ask for them again until invalidated", async () => {
    getSystemDetails.mockImplementation(async (ids) =>
      ids.filter((id) => id !== 9).map((id) => systemDetails({ id })),
    );
    useDetailsStore.getState().request([9, 10]);
    await vi.advanceTimersByTimeAsync(100);
    const state = useDetailsStore.getState();
    expect(state.details.has(9)).toBe(false);
    expect(state.details.has(10)).toBe(true);
    expect(state.pending.size).toBe(0);

    useDetailsStore.getState().request([9, 11]);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenLastCalledWith([11]);

    useDetailsStore.getState().invalidate([9]);
    useDetailsStore.getState().request([9]);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenLastCalledWith([9]);
  });
});

describe("invalidate", () => {
  it("keeps the stale details until the fresh ones land, and leaves the rest alone", async () => {
    useDetailsStore.getState().request([1, 2]);
    await vi.advanceTimersByTimeAsync(100);
    const stale = useDetailsStore.getState().details.get(1);
    const before = useDetailsStore.getState().version;

    useDetailsStore.getState().invalidate([1]);
    const state = useDetailsStore.getState();
    expect(state.details.get(1)).toBe(stale);
    expect(state.details.has(2)).toBe(true);
    expect(state.version).toBe(before + 1);

    getSystemDetails.mockImplementationOnce(async (ids) =>
      ids.map((id) => ({ ...systemDetails({ id }), with_game_data: true })),
    );
    useDetailsStore.getState().request([1, 2]);
    expect(useDetailsStore.getState().details.get(1)).toBe(stale);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenLastCalledWith([1]);
    expect(useDetailsStore.getState().details.get(1)?.with_game_data).toBe(true);

    const unchanged = useDetailsStore.getState().version;
    useDetailsStore.getState().invalidate([99]);
    expect(useDetailsStore.getState().version).toBe(unchanged);
  });

  it("drops the answer of a fetch the edit overtook, and re-requests the id", async () => {
    let finish!: (d: SystemDetails[]) => void;
    getSystemDetails.mockReturnValueOnce(new Promise((r) => (finish = r)));
    useDetailsStore.getState().request([5]);
    await vi.advanceTimersByTimeAsync(100);
    expect(useDetailsStore.getState().pending.has(5)).toBe(true);

    useDetailsStore.getState().invalidate([5]);
    expect(useDetailsStore.getState().pending.has(5)).toBe(false);

    finish([{ ...systemDetails({ id: 5 }), with_game_data: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(useDetailsStore.getState().details.has(5)).toBe(false);

    useDetailsStore.getState().request([5]);
    await vi.advanceTimersByTimeAsync(100);
    expect(getSystemDetails).toHaveBeenCalledTimes(2);
    expect(getSystemDetails).toHaveBeenLastCalledWith([5]);
    expect(useDetailsStore.getState().details.get(5)?.with_game_data).toBe(false);
  });
});

describe("clear", () => {
  it("drops a recorded failure, so the next document asks for that system again", async () => {
    getSystemDetails.mockRejectedValueOnce({ kind: "no_session", message: "nothing open" });
    useDetailsStore.getState().request([7]);
    await vi.advanceTimersByTimeAsync(100);
    expect(useDetailsStore.getState().failed.get(7)).toBe("nothing open");

    useDetailsStore.getState().clear();
    useDetailsStore.getState().request([7]);
    await vi.advanceTimersByTimeAsync(100);

    expect(getSystemDetails).toHaveBeenCalledTimes(2);
    expect(useDetailsStore.getState().details.has(7)).toBe(true);
  });

  it("empties the cache, drops the queue and ignores answers still in flight", async () => {
    useDetailsStore.getState().request([1, 2]);
    await vi.advanceTimersByTimeAsync(100);
    expect(useDetailsStore.getState().details.size).toBe(2);

    let finish!: (d: SystemDetails[]) => void;
    getSystemDetails.mockReturnValueOnce(new Promise((r) => (finish = r)));
    useDetailsStore.getState().request([3]);
    await vi.advanceTimersByTimeAsync(100);
    useDetailsStore.getState().request([4]);

    useDetailsStore.getState().clear();
    finish([systemDetails({ id: 3 })]);
    await vi.advanceTimersByTimeAsync(100);

    const state = useDetailsStore.getState();
    expect(state.details.size).toBe(0);
    expect(state.pending.size).toBe(0);
    expect(getSystemDetails).toHaveBeenCalledTimes(2);
  });
});

describe("loadResourceIcons", () => {
  it("maps each resource to its sprite and bumps the version", async () => {
    getResourceIcons.mockResolvedValueOnce([
      { resource: "energy", sprite: "GFX_energy" },
      { resource: "minerals", sprite: "GFX_minerals" },
    ]);
    const before = useDetailsStore.getState().version;
    await useDetailsStore.getState().loadResourceIcons();
    const state = useDetailsStore.getState();
    expect([...state.resourceIcons]).toEqual([
      ["energy", "GFX_energy"],
      ["minerals", "GFX_minerals"],
    ]);
    expect(state.version).toBe(before + 1);
  });

  it("records a failure instead of caching an empty map, and asking again retries", async () => {
    const before = useDetailsStore.getState().resourceIcons;
    getResourceIcons.mockRejectedValueOnce({ kind: "no_game_data", message: "not loaded" });
    await useDetailsStore.getState().loadResourceIcons();
    expect(useDetailsStore.getState().resourceIcons).toBe(before);
    expect(useDetailsStore.getState().resourceIconsError).toBe("not loaded");

    getResourceIcons.mockResolvedValueOnce([{ resource: "energy", sprite: "GFX_energy" }]);
    await useDetailsStore.getState().loadResourceIcons();
    const state = useDetailsStore.getState();
    expect([...state.resourceIcons]).toEqual([["energy", "GFX_energy"]]);
    expect(state.resourceIconsError).toBeNull();
  });
});
