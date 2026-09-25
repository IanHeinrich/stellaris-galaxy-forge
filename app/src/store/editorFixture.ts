import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import type { SystemNode } from "../generated/SystemNode";
import { lanesTo, node, OPEN_RESULT, SCENARIO_RESULT } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { armSession, mocked, resetStores } from "./storeFixture";

export { mocked };

export const editor = () => useEditorStore.getState();
export const sessionError = () => useFileSessionStore.getState().error;

bindStores();

/** The state every editor test starts from: cleared stores, armed commands, the sample save open. */
export async function openFixtureSave(): Promise<void> {
  resetStores();
  armSession();
  await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
}

/** `openFixtureSave`, then the same galaxy opened as `scenario`. */
export async function openFixtureScenario(scenario = SCENARIO_RESULT): Promise<void> {
  await openFixtureSave();
  mocked.openSave.mockResolvedValueOnce(scenario);
  await useFileSessionStore.getState().openSave(scenario.path);
}

/** A system the open save added this session. */
export function addedNode(
  id: number,
  x: number,
  y: number,
  extra: Partial<SystemNode> = {},
): SystemNode {
  return node(id, `NAME_Added_${id}`, x, y, "sc_g", [], { added: true, ...extra });
}

/** The fixture save with two systems added this session, 6 and 7. */
export function withAddedSystems(): [SystemNode, SystemNode] {
  const six = addedNode(6, -50, -20);
  const seven = addedNode(7, 50, 20);
  useGalaxyStore.getState().applyDelta({ systems: [six, seven] });
  return [six, seven];
}

/** A promise and the way to settle it, for an answer a test holds back. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Joins each pair on both ends in the galaxy as it stands: with a lane, or kept from one as the
 * scenario's `prevented` list names it.
 */
export function joinBoth(by: "lanes" | "prevented", ...pairs: Array<[number, number]>): void {
  const all = useGalaxyStore.getState().systems;
  const touched = new Map<number, SystemNode>();
  for (const [a, b] of pairs) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const s = touched.get(from) ?? all.get(from)!;
      touched.set(
        from,
        by === "lanes"
          ? { ...s, lanes: [...s.lanes, ...lanesTo(to)] }
          : { ...s, prevented: [...s.prevented, to] },
      );
    }
  }
  useGalaxyStore.getState().applyDelta({ systems: [...touched.values()] });
}
