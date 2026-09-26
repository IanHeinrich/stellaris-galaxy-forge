import { create } from "zustand";
import { renumberedId, type Renumbering } from "../lib/renumber";
import { barModeOf, type BarMode } from "../lib/visual/barMode";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useInspectorStore } from "./inspectorStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useToolStore } from "./toolStore";

/** What the map shows: the whole galaxy, or one system's bodies. */
export type Scene = { kind: "galaxy" } | { kind: "system"; id: number };

export const GALAXY_SCENE: Scene = { kind: "galaxy" };

export interface SceneState {
  scene: Scene;
  /** Which roll of a scenario system's initializer the system view draws; 0 on entering one. */
  roll: number;
  /** Draws the scenario system shown as another roll of its initializer. */
  rollAgain(): void;
  /**
   * Shows system `id`, selecting it when it is not already the one selection. The galaxy's tool
   * goes back to Select and its menu, tooltip, hover and overlays go.
   */
  enterSystem(id: number): void;
  /** Back to the galaxy, with the inspector on the system's page and the system still selected. */
  leaveSystem(): void;
  /** Follows an edit that renumbered the system shown; one it removed leaves the scene. */
  renumber(pairs: Renumbering): void;
}

/** The system the map shows, or null while it shows the galaxy. */
export function sceneSystem(): number | null {
  const { scene } = useSceneStore.getState();
  return scene.kind === "system" ? scene.id : null;
}

/** The bar the chrome shows now, for the commands that run outside React. */
export function currentBarMode(): BarMode {
  return barModeOf(useFileSessionStore.getState().kind, sceneSystem() !== null);
}

/** The bar the chrome shows, as a component reads it. */
export function useBarMode(): BarMode {
  const kind = useFileSessionStore((s) => s.kind);
  const inSystem = useSceneStore((s) => s.scene.kind === "system");
  return barModeOf(kind, inSystem);
}

/** Whether Roll again has anything to do: a scenario system is shown. */
export function canRollAgain(): boolean {
  return sceneSystem() !== null && useFileSessionStore.getState().kind === "scenario";
}

/** Whether the enter routes offer a system scene: on any open document, save or scenario. */
export function canEnterSystem(): boolean {
  return useFileSessionStore.getState().status === "ready";
}

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: GALAXY_SCENE,
  roll: 0,

  rollAgain() {
    if (!canRollAgain()) return;
    set({ roll: get().roll + 1 });
  },

  enterSystem(id) {
    if (!useGalaxyStore.getState().systems.has(id)) return;
    // The scene goes first, so the selection following it already sees the system as shown.
    set({ scene: { kind: "system", id }, roll: 0 });
    const editor = useEditorStore.getState();
    const { selection } = editor;
    if (selection.length !== 1 || selection[0] !== id) void editor.select(id);
    useToolStore.getState().setTool("select");
    const chrome = useMapChromeStore.getState();
    chrome.closeContextMenu();
    chrome.hideTooltip();
    editor.setHover(null);
    // Not `clearOverlays`: the hidden initializers belong to the document.
    chrome.setLanePreview(null);
    chrome.setHighlightInitializer(null);
    chrome.setGesture(null);
  },

  leaveSystem() {
    if (get().scene.kind === "galaxy") return;
    useInspectorStore.getState().popTo(0);
    set({ scene: GALAXY_SCENE, roll: 0 });
  },

  renumber(pairs) {
    const { scene } = get();
    if (scene.kind !== "system") return;
    const id = renumberedId(pairs, scene.id);
    if (id === scene.id) return;
    set({ scene: id === null ? GALAXY_SCENE : { kind: "system", id } });
  },
}));
