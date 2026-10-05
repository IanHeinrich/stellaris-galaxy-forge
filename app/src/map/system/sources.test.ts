import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));

import { byId, countryNode, gameDataSummary, placedNode, systemDetails } from "../../test/builders";
import { systemRoll } from "../../test/rolls";
import { SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { systemContext } from "./context";
import { SYSTEM } from "./fixture";
import { useDetailsStore } from "../../store/detailsStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSceneStore } from "../../store/sceneStore";
import {
  documentSubject,
  NO_SOURCES,
  readSystemSources,
  sameSources,
  SOURCE_FOLLOWS,
} from "./sources";

describe("the bodies locked to what they orbit", () => {
  it("are read from the scene store into the context, and a lock changes what the scene reads", () => {
    const before = readSystemSources(null, documentSubject());
    useSceneStore.getState().lockBody(3);
    const after = readSystemSources(null, documentSubject());
    expect(sameSources(before, after)).toBe(false);
    expect(systemContext(after).lockedBodies.has(3)).toBe(true);
    useSceneStore.getState().unlockBody(3);
    expect(systemContext(readSystemSources(null, documentSubject())).lockedBodies.has(3)).toBe(
      false,
    );
  });
});

/** A store whose fields a test sets and puts back. */
interface Settable {
  getState(): object;
  setState(state: object, replace?: boolean): void;
}

const READ_STORES: Readonly<Record<string, Settable>> = {
  galaxy: useGalaxyStore,
  gameData: useGameDataStore,
  details: useDetailsStore,
  scene: useSceneStore,
  session: useFileSessionStore,
  chrome: useMapChromeStore,
};

/** Runs `change`, puts every store back, and says whether the sources and the follows moved. */
function afterChange(change: () => void): { changed: boolean; followed: boolean } {
  const kept = Object.values(READ_STORES).map((store) => [store, store.getState()] as const);
  let followed = false;
  const view = { refresh: () => (followed = true) };
  const offs = SOURCE_FOLLOWS.map((follow) => follow.subscribe(view));
  const before = readSystemSources(SYSTEM, documentSubject());
  change();
  const changed = !sameSources(before, readSystemSources(SYSTEM, documentSubject()));
  for (const off of offs) off();
  for (const [store, state] of kept) store.setState(state, true);
  return { changed, followed };
}

/** Another value of `value`'s kind, or undefined for one a sweep leaves alone. */
function another(value: unknown): unknown {
  if (value instanceof Map) return new Map(value);
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return [...value];
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (value !== null && typeof value === "object") return { ...value };
  return undefined;
}

describe("the store fields the scene reads", () => {
  it("each change what the scene reads, and the scene follows each", () => {
    const changes: Record<string, () => void> = {
      systems: () => useGalaxyStore.setState({ systems: byId(placedNode(SYSTEM, 0, 0)) }),
      countries: () =>
        useGalaxyStore.setState({ countries: new Map([[9, countryNode({ id: 9 })]]) }),
      details: () =>
        useDetailsStore.setState({ details: new Map([[SYSTEM, systemDetails({ id: SYSTEM })]]) }),
      rolls: () =>
        useDetailsStore.setState({ rolls: new Map([[SYSTEM, systemRoll({ system: SYSTEM })]]) }),
      resourceIcons: () => useDetailsStore.setState({ resourceIcons: new Map([["food", "f"]]) }),
      names: () => useGameDataStore.setState({ names: new Map([["NAME", "Name"]]) }),
      status: () => useGameDataStore.setState({ status: "ready" }),
      planetClasses: () => useGameDataStore.setState({ planetClasses: new Map() }),
      starClasses: () => useGameDataStore.setState({ starClasses: new Map() }),
      summary: () => useGameDataStore.setState({ summary: gameDataSummary() }),
      bypasses: () => useGameDataStore.setState({ bypasses: new Map() }),
      kind: () => useFileSessionStore.setState({ kind: "scenario" }),
      capabilities: () => useFileSessionStore.setState({ capabilities: SCENARIO_CAPABILITIES }),
      sceneLayers: () => useMapChromeStore.setState({ sceneLayers: { ...NO_SOURCES.sceneLayers } }),
      lockedBodies: () => useSceneStore.setState({ lockedBodies: new Set([3]) }),
    };
    const moved = Object.entries(changes).map(([field, change]) => [field, afterChange(change)]);
    expect(moved).toEqual(
      Object.keys(changes).map((field) => [field, { changed: true, followed: true }]),
    );
  });

  it("are all followed: no field of the stores it reads changes the scene unfollowed", () => {
    const unfollowed: string[] = [];
    for (const [name, store] of Object.entries(READ_STORES)) {
      for (const [field, value] of Object.entries(store.getState())) {
        const next = another(value);
        if (next === undefined) continue;
        const { changed, followed } = afterChange(() => store.setState({ [field]: next }));
        if (changed && !followed) unfollowed.push(`${name}.${field}`);
      }
    }
    expect(unfollowed).toEqual([]);
  });
});
