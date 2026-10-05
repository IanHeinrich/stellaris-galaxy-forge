import { detailNameKeys } from "../lib/details/labels";
import { SOURCES, groupState, sectionIdsOf, splitsBySource } from "../lib/visual/layerGroups";
import { documentCapabilities } from "../lib/capabilities";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useEntityStore } from "./entityStore";
import { getPaintLayer, redrawStars, useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useHeightPreviewStore } from "./heightPreviewStore";
import { useInspectorStore, type Entry } from "./inspectorStore";
import {
  noteDuplicateNames,
  noteGalaxySize,
  noteInitializerLimits,
  noteReservedSpawns,
} from "./issueNotes";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { useLGateStore } from "./lgateStore";
import { useMapChromeStore } from "./mapChromeStore";
import { usePaintModStore } from "./paintModStore";
import { usePlanetMoveStore } from "./planetMoveStore";
import { galaxyShown, outcomeInView, usePrepareStore } from "./prepareStore";
import { DOCUMENT_SCOPED, GAME_DATA_SCOPED } from "./resetScopes";
import { currentBarMode, sceneSystem, useSceneStore, type BodySelection } from "./sceneStore";
import { symmetryAllowed, SYMMETRY_OFF, toolAllowed, useToolStore } from "./toolStore";
import { useWatchlistStore } from "./watchlistStore";

/** How long after the last edit the watchlist runs its searches again. */
const WATCHLIST_SETTLE_MS = 400;
/** How long after the last edit the Prepare preview is read again. */
const PREPARE_SETTLE_MS = 300;

let bound = false;

/**
 * Subscribes the stores that follow one another: what the open file decides for the
 * selection, the issues, the map chrome, the map's tool and the entities read from it, what a
 * source with nothing drawing decides for the inspector's sections filled from it, what
 * the dock's Issues tab borrows from the map, what each side of the game data owes
 * the other, and what a fresh read of the launcher says about the Paint a Galaxy mod.
 * Called once, where the app boots.
 */
export function bindStores(): void {
  if (bound) return;
  bound = true;
  followSession();
  followGroups();
  followIssuesTab();
  followGameData();
  followDetails();
  followLocks();
  followScenarioInitializers();
  followPaintMod();
  followGalaxySize();
  followNotes();
  followTool();
  followScene();
  followSymmetry();
  followWatchlist();
  followPlanetMove();
  followBodySelectionPage();
  followBodyPages();
  followHeightPreview();
  followPrepare();
}

// The Prepare preview counts what its choices would change in the document as it stands. An edit,
// undo or redo marks it stale at once and reads it again once the edits settle, and another
// document or other game data reads it again, but only while the Galaxy page is in view: a page
// out of view keeps its last count until it is shown. A save just taken into a scenario shows the
// Galaxy page with the section open.
function followPrepare(): void {
  const prepare = () => usePrepareStore.getState();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const refresh = () => {
    cancel();
    pending = !galaxyShown();
    if (!pending) void prepare().refresh();
  };
  const settle = () => {
    cancel();
    timer = setTimeout(refresh, PREPARE_SETTLE_MS);
  };
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status === previous.status) return;
    if (state.status === "ready" && state.fromSave) void prepare().reveal();
    refresh();
  });
  useEditorStore.subscribe((state, previous) => {
    if (state.history === previous.history) return;
    prepare().followHistory(state.history.undo);
    settle();
  });
  useGameDataStore.subscribe((state, previous) => {
    if (state.status !== previous.status || state.version !== previous.version) refresh();
  });
  const shown = () => {
    if (pending && timer === null && galaxyShown()) refresh();
  };
  useInspectorStore.subscribe((state, previous) => {
    if (state.stack !== previous.stack) shown();
  });
  useLayoutStore.subscribe((state, previous) => {
    if (state.tab !== previous.tab || state.collapsed !== previous.collapsed) shown();
  });
  followOutcome();
}

// The map marks what each system becomes while the section can be seen: open on the Galaxy page,
// or as the setup screen.
function followOutcome(): void {
  const sync = () => usePrepareStore.getState().showOutcome(outcomeInView());
  useFileSessionStore.subscribe((state, previous) => {
    if (
      state.status !== previous.status ||
      state.kind !== previous.kind ||
      state.fromSave !== previous.fromSave
    ) {
      sync();
    }
  });
  useInspectorStore.subscribe((state, previous) => {
    if (state.stack !== previous.stack || state.sections !== previous.sections) sync();
  });
  useLayoutStore.subscribe((state, previous) => {
    if (state.tab !== previous.tab || state.collapsed !== previous.collapsed) sync();
  });
  usePrepareStore.subscribe((state, previous) => {
    if (state.applied !== previous.applied || state.dismissed !== previous.dismissed) sync();
  });
}

// A height preview belongs to the system the inspector shows and to the document as it stands:
// another selection, an edit, undo or redo drops it, and so does another document (`DOCUMENT_SCOPED`).
function followHeightPreview(): void {
  const clear = () => useHeightPreviewStore.getState().clear();
  useEditorStore.subscribe((state, previous) => {
    if (state.selection !== previous.selection) clear();
  });
  useGalaxyStore.subscribe((state, previous) => {
    if (state.version !== previous.version || state.galaxy !== previous.galaxy) clear();
  });
}

// A body selection and a cut belong to the open document (`DOCUMENT_SCOPED`). The selection belongs to one system,
// so entering another clears it, and a body the details no longer hold there leaves it. A
// selection of one body follows the inspector's page. An edit, undo or redo can change where
// planets may go, so the targets are read again.
function followPlanetMove(): void {
  const moves = () => usePlanetMoveStore.getState();
  const scene = () => useSceneStore.getState();
  useEditorStore.subscribe((state, previous) => {
    if (state.history === previous.history) return;
    if (useFileSessionStore.getState().status === "ready") moves().refresh();
  });
  useSceneStore.subscribe((state, previous) => {
    if (state.bodySelection !== previous.bodySelection) moves().followSelection();
    if (state.scene === previous.scene && state.visit === previous.visit) return;
    const selection = state.bodySelection;
    const entered = state.visit !== previous.visit;
    if (entered && selection !== null && selection.system !== sceneSystem()) scene().clearBodies();
    scene().followInspector();
  });
  useInspectorStore.subscribe((state, previous) => {
    if (state.stack !== previous.stack) scene().followInspector();
  });
  useDetailsStore.subscribe((state, previous) => {
    if (state.details === previous.details) return;
    const selection = scene().bodySelection;
    const after = selection === null ? undefined : state.details.get(selection.system);
    if (after !== undefined && after !== previous.details.get(after.id)) {
      const held = new Set(after.planets.map((p) => p.id));
      scene().keepBodies((id) => held.has(id));
    }
    scene().followInspector();
  });
}

/** What the inspector's stack does to follow the body selection. */
export type SummaryStep =
  { kind: "open"; entry: Entry } | { kind: "pop" } | { kind: "clear" } | null;

/**
 * The step that keeps the summary above the shown system's page while two or more of its bodies
 * are selected, and takes it away once fewer are. Leaving the summary by its crumbs, with the
 * selection as it was `before`, clears the selection, since the summary would only come back.
 */
export function summaryStep(
  selection: BodySelection | null,
  shown: number | null,
  stack: readonly Entry[],
  before: { selection: BodySelection | null; stack: readonly Entry[] },
): SummaryStep {
  const root = stack[0].ref;
  const page = stack.length > 1 ? stack[1] : null;
  const summary = page !== null && page.ref.kind === "bodies";
  const wanted =
    selection !== null &&
    selection.ids.length > 1 &&
    selection.system === shown &&
    root.kind === "system" &&
    root.id === shown;
  if (!wanted) return summary ? { kind: "pop" } : null;
  const left =
    selection === before.selection && stack.length === 1 && before.stack[1]?.ref.kind === "bodies";
  if (left) return { kind: "clear" };
  const label = `${selection.ids.length} selected`;
  if (summary && page.label === label) return null;
  return { kind: "open", entry: { ref: { kind: "bodies", system: selection.system }, label } };
}

// The summary of two or more selected bodies follows the selection, as `summaryStep` says.
function followBodySelectionPage(): void {
  let seen = {
    selection: useSceneStore.getState().bodySelection,
    shown: sceneSystem(),
    stack: useInspectorStore.getState().stack,
  };
  const follow = () => {
    const now = {
      selection: useSceneStore.getState().bodySelection,
      shown: sceneSystem(),
      stack: useInspectorStore.getState().stack,
    };
    if (now.selection === seen.selection && now.shown === seen.shown && now.stack === seen.stack) {
      return;
    }
    const step = summaryStep(now.selection, now.shown, now.stack, seen);
    seen = now;
    if (step === null) return;
    if (step.kind === "open") useInspectorStore.getState().openFromMap(step.entry);
    else if (step.kind === "pop") useInspectorStore.getState().popTo(0);
    else useSceneStore.getState().clearBodies();
  };
  useSceneStore.subscribe(follow);
  useInspectorStore.subscribe(follow);
}

// A save body's page says which system its planet is in. A move, or the undo or redo of one,
// stales the page; it is read again, and every inspector page on the planet follows that system.
function followBodyPages(): void {
  useEntityStore.subscribe((state, previous) => {
    if (state.pages === previous.pages && state.stalePages === previous.stalePages) return;
    for (const { ref } of useInspectorStore.getState().stack) {
      if (ref.kind !== "body") continue;
      const page = state.pages.get(ref.id);
      if (page === undefined) continue;
      if (state.stalePages.has(ref.id)) useEntityStore.getState().requestPlanetPage(ref.id);
      else if (page.system !== null && page.system !== ref.system) {
        useInspectorStore.getState().moveBodies([ref.id], page.system);
      }
    }
  });
}

// The galaxy the document holds decides the notes raised on it: a seat's kind or a system count
// can change with any edit, and a scenario's name is checked against its folder on open and save.
function followNotes(): void {
  useGalaxyStore.subscribe((state, previous) => {
    if (state.version === previous.version) return;
    noteReservedSpawns();
    noteGalaxySize();
    noteInitializerLimits();
    if (state.galaxy !== previous.galaxy) void noteDuplicateNames();
  });
  useFileSessionStore.subscribe((state, previous) => {
    if (state.lastSave !== previous.lastSave && state.lastSave !== null) void noteDuplicateNames();
  });
}

// The watchlist answers for the open document: every entry runs when one opens, and again once
// edits or a fresh read of what the systems hold settle. Its answers go with the document.
function followWatchlist(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const settle = () => {
    if (useFileSessionStore.getState().status !== "ready") return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      void useWatchlistStore.getState().refresh();
    }, WATCHLIST_SETTLE_MS);
  };
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status === previous.status) return;
    cancel();
    if (state.status === "ready") void useWatchlistStore.getState().refresh();
    else useWatchlistStore.getState().clearResults();
  });
  useGalaxyStore.subscribe((state, previous) => {
    if (state.version !== previous.version && state.galaxy === previous.galaxy) settle();
  });
  useGameDataStore.subscribe((state, previous) => {
    if (state.special !== previous.special) settle();
  });
}

// Game data loading, reloading or going away changes the largest galaxy size a scenario is held to.
function followGalaxySize(): void {
  useGameDataStore.subscribe((state, previous) => {
    if (state.summary !== previous.summary || state.status !== previous.status) noteGalaxySize();
  });
}

// A tool the document in hand or the scene on show cannot take, or any tool once the document
// goes, falls back to Select.
function followTool(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status === previous.status && state.capabilities === previous.capabilities) return;
    const { tool } = useToolStore.getState();
    if (tool === "select") return;
    if (state.status !== "ready" || !toolAllowed(tool, currentBarMode())) {
      useToolStore.setState({ tool: "select" });
    }
  });
  useSceneStore.subscribe((state, previous) => {
    if (state.scene === previous.scene) return;
    const { tool } = useToolStore.getState();
    if (tool !== "select" && !toolAllowed(tool, currentBarMode())) {
      useToolStore.setState({ tool: "select" });
    }
  });
}

// A system scene stays up only while its system is the one selection. A focus on another system
// leaves it too, since the camera heads there; a pan keeps it.
function followScene(): void {
  useEditorStore.subscribe((state, previous) => {
    const shown = sceneSystem();
    if (shown === null) return;
    const { selection, focus } = state;
    const deselected =
      selection !== previous.selection && (selection.length !== 1 || selection[0] !== shown);
    const focusedAway = focus !== previous.focus && focus !== null && focus.id !== shown;
    if (deselected || focusedAway) useSceneStore.getState().exitScene();
  });
  useSceneStore.subscribe((state, previous) => {
    if (state.visit !== previous.visit) enteredSystem();
    else if (state.scene.kind === "galaxy" && previous.scene.kind === "system") exitedSystem();
  });
}

// Entering a system selects it, with the galaxy's menu, tooltip, hover and overlays gone; the
// tool is `followTool`'s to put back. The scene is already up, so the selection following it sees the system as shown.
function enteredSystem(): void {
  const shown = sceneSystem();
  if (shown === null) return;
  const editor = useEditorStore.getState();
  const { selection } = editor;
  if (selection.length !== 1 || selection[0] !== shown) void editor.select(shown);
  const chrome = useMapChromeStore.getState();
  chrome.closeContextMenu();
  chrome.hideTooltip();
  editor.setHover(null);
  // Not `clearOverlays`: the hidden initializers belong to the document.
  chrome.setLanePreview(null);
  chrome.setHighlightInitializer(null);
  chrome.setGesture(null);
  chrome.setSceneHint(null);
}

// Leaving a system, however it goes, drops what the scene said in the status bar.
function exitedSystem(): void {
  useMapChromeStore.getState().setSceneHint(null);
}

// Opening a document that takes no symmetry turns off any symmetry left on from the last one,
// for this session only: the preference keeps the user's pick for the next launch.
function followSymmetry(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.capabilities === previous.capabilities) return;
    if (!symmetryAllowed() && useToolStore.getState().symmetry.kind !== "off") {
      useToolStore.setState({ symmetry: SYMMETRY_OFF });
    }
  });
}

// Game data landing, at start or on a reload, means the launcher's playset was read again, and
// what it says of the playset decides whether the open scenario's reserved seats are noted.
// The launcher is polled only while something on screen would change with its answer.
function followPaintMod(): void {
  useGameDataStore.subscribe((state, previous) => {
    if (state.summary !== previous.summary && state.summary !== null) {
      void usePaintModStore.getState().refresh();
    }
  });
  usePaintModStore.subscribe((state, previous) => {
    if (state.paintMod !== previous.paintMod || state.known !== previous.known) {
      noteReservedSpawns();
    }
  });

  let stopWatch: (() => void) | null = null;
  const syncWatch = () => {
    const wanted = paintModPollWanted();
    if (wanted && stopWatch === null) {
      stopWatch = usePaintModStore.getState().watch();
    } else if (!wanted && stopWatch !== null) {
      stopWatch();
      stopWatch = null;
    }
  };
  usePaintModStore.subscribe(syncWatch);
  useFileSessionStore.subscribe(syncWatch);
  useLayoutStore.subscribe(syncWatch);
}

/**
 * Whether a fresh answer about the mod could change what is on screen: the mod is not enabled,
 * and either a Paint a Galaxy choice is ticked in an open dialog, or a scenario is open that is
 * on the mod's layer (the badge warns until the mod is enabled) or off it with the notice still up.
 */
function paintModPollWanted(): boolean {
  const { paintMod, noticeDismissed } = usePaintModStore.getState();
  if (paintMod?.enabled === true) return false;
  const file = useFileSessionStore.getState();
  if (useLayoutStore.getState().scenarioDialog || file.pendingExport !== null) {
    return usePaintModStore.getState().paintChoice;
  }
  if (file.status !== "ready" || !documentCapabilities(file).create_systems) return false;
  return getPaintLayer() || !noticeDismissed;
}

// Game data loading, reloading or going away drops everything read from what it replaces, and
// redraws the stars a scenario takes from its initializers.
function followGameData(): void {
  useGameDataStore.subscribe((state, previous) => {
    if (
      state.status !== previous.status ||
      state.version !== previous.version ||
      state.summary !== previous.summary
    ) {
      for (const reset of GAME_DATA_SCOPED) reset();
      void redrawStars();
    }
  });
}

// Details that land bring localisation keys of their own, which the game data resolves once.
function followDetails(): void {
  useDetailsStore.subscribe((state, previous) => {
    if (state.details === previous.details) return;
    const fresh = [...state.details.values()].filter((d) => previous.details.get(d.id) !== d);
    if (fresh.length === 0) return;
    void useGameDataStore.getState().fetchNames(fresh.flatMap(detailNameKeys));
  });
}

// A lock names a body by id, and an edit that renumbers no system can still take the body away and
// free its id for a new one, so a lock goes once the details that held its body refresh without it.
function followLocks(): void {
  useDetailsStore.subscribe((state, previous) => {
    if (state.details === previous.details) return;
    const scene = useSceneStore.getState();
    if (scene.lockedBodies.size === 0) return;
    for (const [id, before] of previous.details) {
      const after = state.details.get(id);
      if (after === before) continue;
      const kept = new Set(after?.planets.map((p) => p.id));
      for (const { id: body } of before.planets) {
        if (!kept.has(body)) scene.unlockBody(body);
      }
    }
  });
}

// The map draws each scenario system by its initializer's star class, so a document whose systems
// name their initializers reads the list.
function followScenarioInitializers(): void {
  const read = (): void => {
    if (!documentCapabilities(useFileSessionStore.getState()).scripts) return;
    void useGameDataStore.getState().loadInitializers();
  };
  useFileSessionStore.subscribe((state, previous) => {
    if (state.capabilities !== previous.capabilities) read();
  });
  useGameDataStore.subscribe((state, previous) => {
    if (state.status !== previous.status || state.initializers !== previous.initializers) read();
    if (state.initializers !== previous.initializers) noteInitializerLimits();
  });
}

// A derived section is closed by default while nothing of its source draws, so a group crossing
// that line drops the overrides that would otherwise fight the new default.
function followGroups(): void {
  useMapChromeStore.subscribe((state, previous) => {
    if (state.layers === previous.layers && state.shownKinds === previous.shownKinds) return;
    const kind = useFileSessionStore.getState().kind;
    if (!splitsBySource(kind)) return;
    const crossed = SOURCES.filter(
      (source) =>
        (groupState(state, kind, source) === "off") !==
        (groupState(previous, kind, source) === "off"),
    );
    if (crossed.length === 0) return;
    useInspectorStore.getState().resetSections(crossed.flatMap(sectionIdsOf));
  });
}

// Whatever belonged to the document that was open goes when another starts opening or none is
// left; the galaxy stays on screen under the loading overlay until the next one lands.
function followSession(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status === previous.status) return;
    for (const reset of DOCUMENT_SCOPED) reset();
    useSceneStore.getState().exitScene();
    useSceneStore.getState().clearLocks();
    if (state.status === "loading") useLGateStore.getState().hide();
    if (state.status === "empty" || state.status === "error") {
      useGalaxyStore.getState().clear();
      useGameDataStore.getState().onSaveClosed();
    }
    if (state.status !== "ready") useLayoutStore.getState().hideOpenDialog();
    useEditorStore.getState().resetSession();
    useMapChromeStore.getState().clearOverlays();
    if (state.status === "ready") {
      if (state.kind !== null) useMapChromeStore.getState().openedAs(state.kind);
    } else if (previous.status === "ready") useIssuesStore.getState().clear();
  });
}

// The Issues tab borrows the issue highlights while it is open, through `setLayerQuietly` so the
// borrow itself never reaches the user's preferences; layer visibility set by hand does.
function followIssuesTab(): void {
  /** Unsubscribes the watch on the layer, and is null whenever the layer is not borrowed. */
  let watching: (() => void) | null = null;

  // Touching the layer by hand takes it back: from then on it is the user's to leave on or off.
  const release = () => {
    watching?.();
    watching = null;
  };
  const borrow = () => {
    const chrome = useMapChromeStore.getState();
    if (chrome.layers.issues) return;
    chrome.setLayerQuietly("issues", true);
    watching = useMapChromeStore.subscribe((state, previous) => {
      if (state.layers.issues !== previous.layers.issues) release();
    });
  };
  const giveBack = () => {
    if (watching === null) return;
    release();
    useMapChromeStore.getState().setLayerQuietly("issues", false);
  };

  useLayoutStore.subscribe(({ tab }, previous) => {
    if (tab === previous.tab) return;
    if (tab === "issues") borrow();
    else giveBack();
  });
}
