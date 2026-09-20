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
import { FileMenu } from "./panels/chrome/FileMenu";
import { GameDataPanel } from "./panels/chrome/GameDataPanel";
import { LayersMenu } from "./panels/chrome/LayersMenu";
import { LayerToggles } from "./panels/chrome/LayerToggles";
import { Launch } from "./panels/file/Launch";
import { NewScenarioDialog } from "./panels/file/NewScenarioDialog";
import { OpenModeDialog } from "./panels/file/OpenModeDialog";
import { MapTooltip } from "./panels/overlays/MapTooltip";
import { NewNebulaDialog } from "./panels/overlays/NewNebulaDialog";
import { OpenSave } from "./panels/file/OpenSave";
import { SEARCH_INPUT_ID, Search } from "./panels/search/Search";
import { StatusBar } from "./panels/chrome/StatusBar";
import { Toolbar } from "./panels/chrome/Toolbar";
import {
  canGoBack,
  nudgeSelected,
  resizeNebula,
  run,
  toggleLayerKey,
  type CommandEffects,
} from "./store/commands";
import { useEditorStore } from "./store/editorStore";
import { useFileSessionStore } from "./store/fileSessionStore";
import { useGameDataStore } from "./store/gameDataStore";
import { useLayoutStore } from "./store/layoutStore";

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
    <span className="file-name" title={path ?? undefined}>
      {fileName(path) || (title ?? "")}
      {dirty && (
        <span className="dirty-marker" title="Unsaved changes">
          {" "}
          ●
        </span>
      )}
    </span>
  );
}

function TopBar() {
  const ready = useFileSessionStore((s) => s.status === "ready");
  return (
    <header className="top-bar">
      <FileMenu />
      {ready && (
        <>
          <FileState />
          <Toolbar />
        </>
      )}
      <span className="spacer" />
      <Search />
      <span className="spacer" />
      <LayerToggles />
      <LayersMenu />
      <GameDataPanel />
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = isEditableTarget(e.target);
      const step = radiusStepOf(e, inInput);
      if (step !== null && resizeNebula(step)) {
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
    const unlisten = getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await useFileSessionStore.getState().confirmDiscard())) e.preventDefault();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <div className="map-area">
          <MapCanvas />
          <ContextMenu />
          <MapTooltip />
          {status !== "ready" && <Launch />}
          {status === "ready" && openDialog && <OpenSave modal />}
          {scenarioDialog && <NewScenarioDialog />}
          {nebulaPrompt && <NewNebulaDialog />}
          <OpenModeDialog />
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
