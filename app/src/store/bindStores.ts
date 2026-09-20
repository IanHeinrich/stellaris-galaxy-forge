import { detailNameKeys } from "../lib/details/labels";
import { SOURCES, groupState, sectionIdsOf, splitsBySource } from "../lib/visual/layerGroups";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useEntityStore } from "./entityStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";

let bound = false;

/**
 * Subscribes the stores that follow one another: what the open file decides for the
 * selection, the issue baseline, the map chrome and the entities read from it, what a
 * source with nothing drawing decides for the inspector's sections filled from it, what
 * the dock's Issues tab borrows from the map, and what each side of the game data owes
 * the other. Called once, where the app boots.
 */
export function bindStores(): void {
  if (bound) return;
  bound = true;
  followSession();
  followGroups();
  followIssuesTab();
  followEntities();
  followDetails();
  followScenarioInitializers();
}

function followEntities(): void {
  useFileSessionStore.subscribe((state, previous) => {
    if (state.status !== previous.status) useEntityStore.getState().clear();
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
    // A save becomes ready with the issues it arrived with; that set is the baseline until it closes.
    if (state.status === "ready") useIssuesStore.getState().setBaseline(state.issues);
    else if (previous.status === "ready") useIssuesStore.getState().setBaseline(null);
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
