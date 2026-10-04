import { useDetailsStore } from "../../store/detailsStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore, type EntityRef } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { subscribeOwnership } from "../../store/ownership";
import { usePlanetMoveStore } from "../../store/planetMoveStore";
import { useSceneStore } from "../../store/sceneStore";
import { follows, type Binding } from "../follows";

/** What a store change moves in the system scene. */
export interface SceneView {
  /** Re-reads the stores and rebuilds the layers, unless nothing they draw moved. */
  refresh(): void;
  /** Rings the body or wormhole the page on top of the inspector's stack opens, where it is the system's. */
  selectBody(top: EntityRef): void;
  /** Brightens what marks the body a panel's link names while the pointer is on the link. */
  linkBody(id: number | null): void;
  /** Marks the planets selected to move, those cut, and where a lone cut planet would be pasted. */
  showMove(): void;
  /** Centres the camera on body `id` once the system's layout places it. */
  focusBody(id: number): void;
}

const refresh = (_state: unknown, view: SceneView) => view.refresh();
const showMove = (_state: unknown, view: SceneView) => view.showMove();

/** The store fields the system scene follows, and the ones applied as it binds besides. */
const BINDINGS: Array<Binding<SceneView, "bind">> = [
  follows(useDetailsStore, [(s) => s.details, (s) => s.version, (s) => s.rolls], refresh),
  follows(
    useGameDataStore,
    [(s) => s.planetClasses, (s) => s.starClasses, (s) => s.status, (s) => s.initializerClasses],
    refresh,
  ),
  // Ownership's inputs include the systems, the names and the document kind the scene reads too.
  { when: "change", subscribe: (view) => subscribeOwnership(() => view.refresh()) },
  follows(useMapChromeStore, [(s) => s.sceneLayers], refresh),
  follows(useSceneStore, [(s) => s.roll, (s) => s.lockedBodies], refresh),
  follows(useSceneStore, [(s) => s.bodyFocus], (s, view) => {
    if (s.bodyFocus) view.focusBody(s.bodyFocus.id);
  }),
  follows(useSceneStore, [(s) => s.linkedBody], (s, view) => view.linkBody(s.linkedBody), "bind"),
  follows(
    useInspectorStore,
    [(s) => s.stack],
    (s, view) => view.selectBody(s.stack[s.stack.length - 1].ref),
    "bind",
  ),
  follows(useSceneStore, [(s) => s.bodySelection], showMove, "bind"),
  follows(usePlanetMoveStore, [(s) => s.cut], showMove, "bind"),
  follows(useMapChromeStore, [(s) => s.contextMenu], showMove),
];

/** Subscribes the scene to every field it follows and applies the ones that stand now. */
export function bindSystemScene(view: SceneView): () => void {
  const offs = BINDINGS.map((binding) => {
    if (binding.when === "bind") binding.apply?.(view);
    return binding.subscribe(view);
  });
  return () => {
    for (const off of offs) off();
  };
}
