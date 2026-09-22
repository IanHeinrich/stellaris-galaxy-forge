import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import "./App.css";
import { isEditableTarget, keyAction, layerKeyOf, nudgeOf, radiusStepOf } from "./lib/keys";
import { fileName } from "./lib/paths";
import { MapCanvas } from "./map/MapCanvas";
import { ContextMenu } from "./panels/overlays/ContextMenu";
import { LoadingOverlay } from "./panels/overlays/LoadingOverlay";
import { InitializerBrowser } from "./panels/initializers/Browser";
import { browseInitializers } from "./panels/initializers/entry";
import { confirmRemoveNebula } from "./panels/inspector/nebula";
import { Dock } from "./panels/chrome/Dock";
import { EditMenu } from "./panels/chrome/EditMenu";
import { FileMenu } from "./panels/chrome/FileMenu";
import { PaintBadge } from "./panels/chrome/PaintBadge";
import { PaintNotice } from "./panels/chrome/PaintNotice";
import { HelpMenu } from "./panels/chrome/HelpMenu";
import { LayersMenu } from "./panels/chrome/LayersMenu";
import { LayerToggles } from "./panels/chrome/LayerToggles";
import { ExportDialog } from "./panels/file/ExportDialog";
import { Launch } from "./panels/file/Launch";
import { NewScenarioDialog } from "./panels/file/NewScenarioDialog";
import { OpenModeDialog } from "./panels/file/OpenModeDialog";
import { MapTooltip } from "./panels/overlays/MapTooltip";
import { FeZoneFitDialog } from "./panels/overlays/FeZoneFitDialog";
import { NewNebulaDialog } from "./panels/overlays/NewNebulaDialog";
import { SaveIssuesDialog } from "./panels/overlays/SaveIssuesDialog";
import { UpdateBadge } from "./panels/chrome/UpdateBadge";
import { UpdateDialog } from "./panels/overlays/UpdateDialog";
import { OpenSave } from "./panels/file/OpenSave";
import { SEARCH_INPUT_ID, Search } from "./panels/search/Search";
import { StatusBar } from "./panels/chrome/StatusBar";
import { ToolOptions } from "./panels/chrome/ToolOptions";
import { ToolRail } from "./panels/chrome/ToolRail";
import { ViewMenu } from "./panels/chrome/ViewMenu";
import { TrafficLightInset, WindowControls } from "./panels/chrome/WindowControls";
import {
  canGoBack,
  nudgeSelected,
  resizeBrush,
  resizeNebula,
  run,
  toggleLayerKey,
  type CommandEffects,
} from "./store/commands";
import { useEditorStore } from "./store/editorStore";
import { useFileSessionStore } from "./store/fileSessionStore";
import { useGameDataStore } from "./store/gameDataStore";
import { useLayoutStore } from "./store/layoutStore";
import { usePaintModStore } from "./store/paintModStore";
import { useUpdateStore } from "./store/updateStore";

function FileState() {
  const path = useFileSessionStore((s) => s.path);
  const title = useFileSessionStore((s) => s.title);
  const dirty = useFileSessionStore((s) => s.dirty);
  const saving = useFileSessionStore((s) => s.saving);
  const progress = useFileSessionStore((s) => s.progress);
  if (saving) {
    const percent = Math.round((progress?.fraction ?? 0) * 100);
    return (
      <div className="save-progress" title="Writing the save">
        <span>Saving… {percent}%</span>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }
  return (
    <>
      <span className="file-name" title={path ?? undefined} data-tauri-drag-region>
        {fileName(path) || (title ?? "")}
        {dirty && (
          <span className="dirty-marker" title="Unsaved changes">
            {" "}
            ●
          </span>
        )}
      </span>
      <PaintBadge />
    </>
  );
}

function TopBar() {
  const ready = useFileSessionStore((s) => s.status === "ready");
  return (
    <header className="top-bar" data-tauri-drag-region>
      <TrafficLightInset />
      <img className="app-icon" src="/favicon.svg" alt="" data-tauri-drag-region />
      <nav className="menu-bar" aria-label="Menus" data-tauri-drag-region>
        <FileMenu />
        <EditMenu />
        <ViewMenu />
        <HelpMenu />
      </nav>
      {ready && <FileState />}
      <Search />
      <span className="spacer" data-tauri-drag-region />
      <LayerToggles />
      <LayersMenu />
      <UpdateBadge />
      <WindowControls />
    </header>
  );
}

const EFFECTS: CommandEffects = {
  focusSearch: () => document.getElementById(SEARCH_INPUT_ID)?.focus(),
  browseInitializers,
  confirmRemoveNebula: (index) => void confirmRemoveNebula(index),
};

function App() {
  const status = useFileSessionStore((s) => s.status);
  const openDialog = useLayoutStore((s) => s.openDialog);
  const scenarioDialog = useLayoutStore((s) => s.scenarioDialog);
  const nebulaPrompt = useEditorStore((s) => s.nebulaPrompt);
  const feZoneFitPrompt = useEditorStore((s) => s.feZoneFitPrompt);
  const updateDialog = useUpdateStore((s) => s.dialog);
  const saveIssuesPrompt = useFileSessionStore((s) => s.saveIssuesPrompt);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = isEditableTarget(e.target);
      const step = radiusStepOf(e, inInput);
      if (step !== null && (resizeBrush(step) || resizeNebula(step))) {
        e.preventDefault();
        return;
      }
      const nudge = nudgeOf(e, inInput);
      if (nudge) {
        e.preventDefault();
        nudgeSelected(nudge);
        return;
      }
      const layer = layerKeyOf(e, inInput);
      if (layer !== null) {
        e.preventDefault();
        toggleLayerKey(layer);
        return;
      }
      const action = keyAction(e, inInput, canGoBack());
      if (action !== null && run(action, inInput, EFFECTS)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The webview's own menu offers Back, Refresh and Print, none of which mean anything here,
  // and it covers the menus the map and the panels open on the same button.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!isEditableTarget(e.target)) e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    const note = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      useLayoutStore.getState().noteEventSource(target?.closest(".dock") != null);
    };
    window.addEventListener("pointerdown", note, { capture: true });
    window.addEventListener("keydown", note, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", note, { capture: true });
      window.removeEventListener("keydown", note, { capture: true });
    };
  }, []);

  useEffect(() => {
    void useGameDataStore.getState().start();
  }, []);

  useEffect(() => {
    void useUpdateStore.getState().start();
  }, []);

  useEffect(() => {
    void usePaintModStore.getState().refresh();
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) void usePaintModStore.getState().refresh();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await useFileSessionStore.getState().confirmDiscard())) e.preventDefault();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  return (
    <div className="app">
      <TopBar />
      <PaintNotice />
      <div className="main">
        {status === "ready" && <ToolRail />}
        <div className="map-area">
          <MapCanvas />
          {status === "ready" && <ToolOptions />}
          <ContextMenu />
          <MapTooltip />
          {status !== "ready" && <Launch />}
          {status === "ready" && openDialog && <OpenSave modal />}
          {scenarioDialog && <NewScenarioDialog />}
          {nebulaPrompt && <NewNebulaDialog />}
          {feZoneFitPrompt && <FeZoneFitDialog />}
          {saveIssuesPrompt && <SaveIssuesDialog />}
          <OpenModeDialog />
          {updateDialog && <UpdateDialog />}
          <ExportDialog />
          <InitializerBrowser />
        </div>
        {status === "ready" && <Dock />}
      </div>
      <StatusBar />
      <LoadingOverlay />
    </div>
  );
}

export default App;
