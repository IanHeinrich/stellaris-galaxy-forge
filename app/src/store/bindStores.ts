import { detailNameKeys } from "../lib/details/labels";
import { SOURCES, groupState, sectionIdsOf, splitsBySource } from "../lib/visual/layerGroups";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useEntityStore } from "./entityStore";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useGeneratorStore } from "./generatorStore";
import { useInspectorStore } from "./inspectorStore";
import {
  noteDuplicateNames,
  noteGalaxySize,
  noteInitializerLimits,
  noteReservedSpawns,
} from "./issueNotes";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { usePaintModStore } from "./paintModStore";
import { usePlanetDataStore } from "./planetDataStore";
import { symmetryAllowed, SYMMETRY_OFF, toolAllowed, useToolStore } from "./toolStore";
import { useWatchlistStore } from "./watchlistStore";

/** How long after the last edit the watchlist runs its searches again. */
const WATCHLIST_SETTLE_MS = 400;

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
  followEntities();
  followAddSystemPicks();
  followPlanetData();
  followDetails();
  followScenarioInitializers();
  followPaintMod();
  followGalaxySize();
  followNotes();
  followTool();
  followSymmetry();
  followWatchlist();
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

// A tool the document in hand cannot take, or any tool once the document goes, falls back to Select.
function followTool(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status === previous.status && state.capabilities === previous.capabilities) return;
    const { tool } = useToolStore.getState();
    if (tool === "select") return;
    if (state.status !== "ready" || !toolAllowed(tool)) useToolStore.setState({ tool: "select" });
  });
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
  if (file.status !== "ready" || file.kind !== "scenario") return false;
  return getPaintLayer() || !noticeDismissed;
}

function followEntities(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status !== previous.status) useEntityStore.getState().clear();
  });
}

// The Add system menu's picks count what the open save's galaxy holds.
function followAddSystemPicks(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status !== previous.status) useGeneratorStore.getState().clearPicks();
  });
}

// A planet page's deposits, modifiers and designations, and the star classes a rolled system can
// have, are the loaded game data's to say.
function followPlanetData(): void {
  useGameDataStore.subscribe((state, previous) => {
    if (state.status !== previous.status || state.version !== previous.version) {
      usePlanetDataStore.getState().clear();
      useGeneratorStore.getState().clear();
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

// The map draws each scenario system by its initializer's star class, so a scenario reads the list.
function followScenarioInitializers(): void {
  const read = (): void => {
    if (useFileSessionStore.getState().kind !== "scenario") return;
    void useGameDataStore.getState().loadInitializers();
  };
  useFileSessionStore.subscribe((state, previous) => {
    if (state.kind !== previous.kind) read();
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

function followSession(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status === previous.status) return;
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
