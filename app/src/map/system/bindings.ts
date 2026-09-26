import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore, type EntityRef } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";

/** What a store change moves in the system scene. */
export interface SceneView {
  /** Re-reads the stores and rebuilds the layers, unless nothing they draw moved. */
  refresh(): void;
  /** Rings the body the page on top of the inspector's stack opens, where it is one of the system's. */
  selectBody(top: EntityRef): void;
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

function topRef(): EntityRef {
  const { stack } = useInspectorStore.getState();
  return stack[stack.length - 1].ref;
}

/** The store fields the system scene follows while it is shown. */
const BINDINGS: Binding[] = [
  follows(
    useDetailsStore,
    [(s) => s.details, (s) => s.version, (s) => s.pending, (s) => s.missing],
    (view) => view.refresh(),
  ),
  follows(useGalaxyStore, [(s) => s.systems, (s) => s.countries], (view) => view.refresh()),
  follows(
    useGameDataStore,
    [
      (s) => s.names,
      (s) => s.planetClasses,
      (s) => s.starClasses,
      (s) => s.status,
      (s) => s.mapColors,
      (s) => s.countryTypes,
    ],
    (view) => view.refresh(),
  ),
  follows(useMapChromeStore, [(s) => s.sceneLayers], (view) => view.refresh()),
  follows(useInspectorStore, [(s) => s.stack], (view) => view.selectBody(topRef()), true),
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
