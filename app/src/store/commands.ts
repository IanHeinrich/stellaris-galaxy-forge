/** The app's commands over the stores: what a key press does, apart from the key it was pressed. */
import type { KeyAction, Nudge } from "../lib/keys";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useInitializerBrowserStore } from "./initializerBrowserStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useToolStore } from "./toolStore";

export interface CommandEffects {
  focusSearch(): void;
  browseInitializers(targets: readonly number[]): void;
  confirmRemoveNebula(index: number): void;
}

export function canGoBack(): boolean {
  return useInspectorStore.getState().stack.length > 1;
}

/** `[` / `]` shrink or grow the active brush. True when a brush took the press. */
export function resizeBrush(step: number): boolean {
  const tools = useToolStore.getState();
  if (tools.tool !== "paint" && tools.tool !== "erase") return false;
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
  const editor = useEditorStore.getState();
  const index = editor.selectedNebula;
  if (index === null) {
    void editor.nudgeSelection(dx, dy);
    return;
  }
  const nebula = useGalaxyStore.getState().nebulae[index];
  if (nebula) void editor.moveNebula(index, nebula.x + dx, nebula.y + dy);
}

export function toggleLayerKey(index: number): void {
  useMapChromeStore.getState().toggleLayerKey(index);
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
  } else if (!useInspectorStore.getState().escape()) {
    void useEditorStore.getState().clearSelection();
  }
}

function focusOnMap(): boolean {
  const active = document.activeElement;
  return !(active instanceof Element) || active === document.body || !!active.closest(".map-area");
}

/** Runs one command, and says whether the key press was the app's to keep. */
export function run(action: KeyAction, inInput: boolean, effects: CommandEffects): boolean {
  const editor = useEditorStore.getState();
  const chrome = useMapChromeStore.getState();
  const session = useFileSessionStore.getState();
  const layout = useLayoutStore.getState();
  switch (action) {
    case "open":
      if (session.status === "ready") useLayoutStore.getState().showOpenDialog();
      return true;
    case "browse":
      if (session.status !== "loading" && useGameDataStore.getState().startup !== "setup") {
        void session.pickAndOpen();
      }
      return true;
    case "close":
      if (session.status === "ready") void session.close();
      return true;
    case "clearSelection":
      escape(inInput);
      return false;
    case "deleteSelection":
      if (editor.selectedNebula === null) void editor.deleteSelection();
      else effects.confirmRemoveNebula(editor.selectedNebula);
      return true;
    case "selectAll":
      void editor.selectAll();
      return true;
    case "fit":
      editor.requestFit();
      return true;
    case "fitSelection":
      if (editor.selection.length === 0 && editor.selectedNebula === null) editor.requestFit();
      else editor.fitSelection();
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
      useInspectorStore.getState().back();
      return true;
    case "undo":
      void editor.undo();
      return true;
    case "redo":
      void editor.redo();
      return true;
    case "save":
      void session.save();
      return true;
    case "saveAs":
      void session.saveAs();
      return true;
    case "browseInitializers":
      effects.browseInitializers(editor.selection);
      return true;
    case "toggleScriptLayers":
    case "toggleInitializerLayers":
      if (session.kind !== "scenario" || useGameDataStore.getState().status !== "ready") {
        return false;
      }
      chrome.toggleGroup(action === "toggleScriptLayers" ? "scripts" : "initializers");
      return true;
    case "selectTool":
      useToolStore.getState().setTool("select");
      return true;
    case "paintTool":
      return useToolStore.getState().setTool("paint");
    case "eraseTool":
      return useToolStore.getState().setTool("erase");
  }
}
