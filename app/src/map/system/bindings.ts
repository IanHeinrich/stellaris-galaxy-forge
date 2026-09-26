import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";

/** What a store change moves in the system scene. */
export interface SceneView {
  /** Re-reads the stores and rebuilds the layers, unless nothing they draw moved. */
  refresh(): void;
  /** The planet on top of the inspector's stack, or null when its top is no planet. */
  selectBody(id: number | null): void;
}

interface Store<S> {
  getState(): S;
  subscribe(listener: (state: S, prev: S) => void): () => void;
}

interface Binding {
  /** Applied once as the scene binds, besides whenever a field it follows changes. */
  now: boolean;
  apply: (view: SceneView) => void;
  subscribe: (view: SceneView) => () => void;
}

function follows<S>(
  store: Store<S>,
  fields: ReadonlyArray<(state: S) => unknown>,
  apply: (view: SceneView) => void,
  now = false,
): Binding {
  return {
    now,
    apply,
    subscribe: (view) =>
      store.subscribe((state, prev) => {
        if (fields.some((field) => field(state) !== field(prev))) apply(view);
      }),
  };
}

function topPlanet(): number | null {
  const { stack } = useInspectorStore.getState();
  const top = stack[stack.length - 1].ref;
  return top.kind === "planet" ? top.id : null;
}

/** The store fields the system scene follows while it is shown. */
const BINDINGS: Binding[] = [
  follows(
    useDetailsStore,
    [(s) => s.details, (s) => s.version, (s) => s.pending, (s) => s.missing],
    (view) => view.refresh(),
  ),
  follows(useGalaxyStore, [(s) => s.systems], (view) => view.refresh()),
  follows(
    useGameDataStore,
    [(s) => s.names, (s) => s.planetClasses, (s) => s.starClasses, (s) => s.status],
    (view) => view.refresh(),
  ),
  follows(useInspectorStore, [(s) => s.stack], (view) => view.selectBody(topPlanet()), true),
];

/** Subscribes the scene to every field it follows and applies the ones that stand now. */
export function bindSystemScene(view: SceneView): () => void {
  const offs = BINDINGS.map((binding) => {
    if (binding.now) binding.apply(view);
    return binding.subscribe(view);
  });
  return () => {
    for (const off of offs) off();
  };
}
