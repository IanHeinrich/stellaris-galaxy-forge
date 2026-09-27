import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { PrecursorView } from "../generated/PrecursorView";
import type { SystemNode } from "../generated/SystemNode";
import { systemNode } from "../test/builders";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { currentPrecursors, subscribePrecursors } from "./precursors";
import { resetStores } from "./storeFixture";

beforeEach(resetStores);

const PRECURSOR_DEFS: PrecursorView[] = [
  { key: "precursor_1", name: "Vultaum" },
  { key: "precursor_zroni_1", name: "Zroni" },
];

function systemsOf(...systems: SystemNode[]): Map<number, SystemNode> {
  return new Map(systems.map((s) => [s.id, s]));
}

describe("currentPrecursors", () => {
  it("is empty without any precursor definitions", () => {
    useGalaxyStore.setState({
      systems: systemsOf(systemNode({ id: 1, flags: ["precursor_1"] })),
    });
    const regions = currentPrecursors();
    expect(regions.legend).toEqual([]);
    expect(regions.bySystem.size).toBe(0);
    expect(regions.none).toBe(0);
  });

  it("groups each system's precursor flags by definition, in definition order", () => {
    useGameDataStore.setState({ precursors: PRECURSOR_DEFS });
    useGalaxyStore.setState({
      systems: systemsOf(
        systemNode({ id: 1, flags: ["precursor_zroni_1", "precursor_1"] }),
        systemNode({ id: 2, flags: ["precursor_1"] }),
        systemNode({ id: 3, flags: [] }),
      ),
    });
    const regions = currentPrecursors();
    expect(regions.legend).toEqual([
      { key: "precursor_1", name: "Vultaum", index: 0, count: 2 },
      { key: "precursor_zroni_1", name: "Zroni", index: 1, count: 1 },
    ]);
    expect(regions.bySystem.get(1)).toEqual(["precursor_1", "precursor_zroni_1"]);
    expect(regions.bySystem.get(2)).toEqual(["precursor_1"]);
    expect(regions.bySystem.has(3)).toBe(false);
    expect(regions.none).toBe(1);
  });

  it("ignores a flag no definition names, such as precursor_system", () => {
    useGameDataStore.setState({ precursors: PRECURSOR_DEFS });
    useGalaxyStore.setState({
      systems: systemsOf(systemNode({ id: 1, flags: ["precursor_system"] })),
    });
    const regions = currentPrecursors();
    expect(regions.bySystem.has(1)).toBe(false);
    expect(regions.none).toBe(1);
  });

  it("stays by identity while nothing it reads changes", () => {
    useGameDataStore.setState({ precursors: PRECURSOR_DEFS });
    useGalaxyStore.setState({ systems: systemsOf(systemNode({ id: 1 })) });
    const first = currentPrecursors();
    expect(currentPrecursors()).toBe(first);
  });
});

describe("subscribePrecursors", () => {
  it("calls the listener when the systems or the precursor definitions change, and not once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrecursors(listener);

    useGalaxyStore.setState({ systems: systemsOf(systemNode({ id: 1 })) });
    expect(listener).toHaveBeenCalledTimes(1);

    useGameDataStore.setState({ precursors: PRECURSOR_DEFS });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    useGalaxyStore.setState({ systems: systemsOf(systemNode({ id: 2 })) });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
