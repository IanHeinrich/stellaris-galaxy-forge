import { useInspectorStore, type EntityRef } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { usePlanetMoveStore } from "../../store/planetMoveStore";
import { useSceneStore } from "../../store/sceneStore";
import { follows, type Binding } from "../follows";
import { SOURCE_FOLLOWS } from "./sources";

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

const showMove = (_state: unknown, view: SceneView) => view.showMove();

/** The store fields the system scene follows, and the ones applied as it binds besides. */
const BINDINGS: Array<Binding<SceneView, "bind">> = [
  ...SOURCE_FOLLOWS,
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
