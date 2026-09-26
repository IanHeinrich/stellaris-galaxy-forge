/** The app's commands over the stores: what a key press does, apart from the key it was pressed. */
import { isToolAction, toolOfAction, type KeyAction, type Nudge } from "../lib/keys";
import { isSceneLayer, LAYER_KEYS } from "../lib/visual/layerIds";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useInitializerBrowserStore } from "./initializerBrowserStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useOpenScreenStore } from "./openScreenStore";
import { canEnterSystem, sceneSystem, useSceneStore } from "./sceneStore";
import { symmetryAllowed, useToolStore } from "./toolStore";

export interface CommandEffects {
  focusSearch(): void;
  browseInitializers(targets: readonly number[]): void;
}

function hasCrumb(): boolean {
  return useInspectorStore.getState().stack.length > 1;
}

/** Whether Backspace and Alt+← have somewhere to go back to: a crumb, or out of a system. */
export function canGoBack(): boolean {
  return hasCrumb() || sceneSystem() !== null;
}

/** Pops a crumb, or with none to pop leaves the system shown. */
function goBack(): void {
  if (hasCrumb()) useInspectorStore.getState().back();
  else useSceneStore.getState().leaveSystem();
}

/** Enter: shows the one selected system, with nothing but the map focused. True when it did. */
export function enterSelectedSystem(): boolean {
  const { selection } = useEditorStore.getState();
  if (selection.length !== 1 || sceneSystem() !== null || !canEnterSystem() || !mapHasFocus()) {
    return false;
  }
  useSceneStore.getState().enterSystem(selection[0]);
  return sceneSystem() === selection[0];
}

/** M: shows the one selected system, or leaves the system shown. True when it did either. */
export function toggleSystemView(): boolean {
  if (sceneSystem() !== null) {
    useSceneStore.getState().leaveSystem();
    return true;
  }
  const { selection } = useEditorStore.getState();
  if (selection.length !== 1 || !canEnterSystem()) return false;
  useSceneStore.getState().enterSystem(selection[0]);
  return sceneSystem() === selection[0];
}

/** `[` / `]` shrink or grow the active brush. True when a brush took the press. */
export function resizeBrush(step: number): boolean {
  const tools = useToolStore.getState();
  if (tools.tool === "select") return false;
  tools.stepSize(step < 0 ? -1 : 1);
  return true;
}

/** `[` / `]` resize the selected nebula, one op per press. True when the press was the nebula's. */
export function resizeNebula(step: number): boolean {
  const editor = useEditorStore.getState();
  const index = editor.selectedNebula;
  if (index === null) return false;
  const nebula = useGalaxyStore.getState().nebulae[index];
  if (nebula && nebula.radius + step > 0) void editor.setNebulaRadius(index, nebula.radius + step);
  return true;
}

export function nudgeSelected({ dx, dy }: Nudge): void {
  if (sceneSystem() !== null) return;
  const editor = useEditorStore.getState();
  const index = editor.selectedNebula;
  if (index === null) {
    void editor.nudgeSelection(dx, dy);
    return;
  }
  const nebula = useGalaxyStore.getState().nebulae[index];
  if (nebula) void editor.moveNebula(index, nebula.x + dx, nebula.y + dy);
}

/** A number key: the galaxy's layer, or while a system is up, the scene's own switch for it. */
export function toggleLayerKey(index: number): void {
  const chrome = useMapChromeStore.getState();
  if (sceneSystem() === null) {
    chrome.toggleLayerKey(index);
    return;
  }
  const layer = LAYER_KEYS[index];
  if (layer && isSceneLayer(layer)) chrome.toggleSceneLayer(layer);
}

/** Removes whatever Delete names for the selection, asking first where the store does. */
export function deleteSelected(): void {
  if (sceneSystem() !== null) return;
  void useEditorStore.getState().deleteSelection();
}

export function selectAll(): void {
  if (sceneSystem() !== null) return;
  void useEditorStore.getState().selectAll();
}

export function fitAll(): void {
  useEditorStore.getState().requestFit();
}

/** Frames the selected systems or nebula, or the whole galaxy when nothing is selected. */
export function fitSelected(): void {
  const editor = useEditorStore.getState();
  if (editor.selection.length === 0 && editor.selectedNebula === null) editor.requestFit();
  else editor.fitSelection();
}

export function undo(): void {
  void useEditorStore.getState().undo();
}

export function redo(): void {
  void useEditorStore.getState().redo();
}

export function save(): void {
  void useFileSessionStore.getState().save();
}

export function saveAs(): void {
  void useFileSessionStore.getState().saveAs();
}

/** Closes the open document, once any unsaved changes are agreed to go. */
export function closeDocument(): void {
  const session = useFileSessionStore.getState();
  if (session.status === "ready") void session.close();
}

function escape(inInput: boolean): void {
  if (useInitializerBrowserStore.getState().open) {
    useInitializerBrowserStore.getState().close();
    return;
  }
  if (inInput) return;
  const layout = useLayoutStore.getState();
  const chrome = useMapChromeStore.getState();
  if (layout.openDialog) {
    layout.hideOpenDialog();
  } else if (chrome.contextMenu) {
    chrome.closeContextMenu();
  } else if (useToolStore.getState().tool !== "select") {
    useToolStore.getState().setTool("select");
  } else if (useInspectorStore.getState().escape()) {
    return;
  } else if (sceneSystem() !== null) {
    useSceneStore.getState().leaveSystem();
  } else {
    void useEditorStore.getState().clearSelection();
  }
}

function focusOnMap(): boolean {
  const active = document.activeElement;
  return !(active instanceof Element) || active === document.body || !!active.closest(".map-area");
}

// Menus and dialogs render inside `.map-area` too, and Enter on one of them is its own.
function mapHasFocus(): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body) return true;
  return active instanceof HTMLCanvasElement && active.closest(".map-host") !== null;
}

/** Runs one command, and says whether the key press was the app's to keep. */
export function run(action: KeyAction, inInput: boolean, effects: CommandEffects): boolean {
  if (isToolAction(action)) return useToolStore.getState().setTool(toolOfAction(action));
  const chrome = useMapChromeStore.getState();
  const session = useFileSessionStore.getState();
  const layout = useLayoutStore.getState();
  switch (action) {
    case "open":
      if (session.status === "ready") useLayoutStore.getState().showOpenDialog();
      return true;
    case "browse":
      if (session.status !== "loading" && useGameDataStore.getState().startup !== "setup") {
        void session.pickAndOpen(undefined, undefined, useOpenScreenStore.getState().scenarios);
      }
      return true;
    case "close":
      closeDocument();
      return true;
    case "clearSelection":
      escape(inInput);
      return false;
    case "deleteSelection":
      deleteSelected();
      return true;
    case "selectAll":
      selectAll();
      return true;
    case "fit":
      fitAll();
      return true;
    case "fitSelection":
      fitSelected();
      return true;
    case "focusSearch":
      effects.focusSearch();
      return true;
    case "toggleDock":
      if (!focusOnMap()) return false;
      layout.toggleDock();
      return true;
    case "issuesTab":
      layout.setTab("issues");
      return true;
    case "inspectorBack":
      goBack();
      return true;
    case "enterSystem":
      return enterSelectedSystem();
    case "toggleSystemView":
      return toggleSystemView();
    case "undo":
      undo();
      return true;
    case "redo":
      redo();
      return true;
    case "save":
      save();
      return true;
    case "saveAs":
      saveAs();
      return true;
    case "browseInitializers":
      if (sceneSystem() !== null) return false;
      effects.browseInitializers(useEditorStore.getState().selection);
      return true;
    case "toggleScriptLayers":
    case "toggleInitializerLayers":
      if (
        sceneSystem() !== null ||
        session.kind !== "scenario" ||
        useGameDataStore.getState().status !== "ready"
      ) {
        return false;
      }
      chrome.toggleGroup(action === "toggleScriptLayers" ? "scripts" : "initializers");
      return true;
    case "toggleSymmetry":
      if (!symmetryAllowed() || sceneSystem() !== null) return false;
      useToolStore.getState().toggleSymmetry();
      return true;
  }
}
