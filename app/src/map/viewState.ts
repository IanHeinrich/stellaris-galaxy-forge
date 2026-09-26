import type { GalaxyDelta } from "../generated/GalaxyDelta";
import type { SpecialKind } from "../generated/SpecialKind";
import type { AppIssue } from "../lib/issues";
import type { LayerId } from "../lib/visual/layerIds";
import { watchRings, type WatchRings } from "../lib/watchlist";
import { useDetailsStore } from "../store/detailsStore";
import { useEditorStore } from "../store/editorStore";
import { useFileSessionStore } from "../store/fileSessionStore";
import { useGalaxyStore } from "../store/galaxyStore";
import { useGameDataStore } from "../store/gameDataStore";
import { useIssuesStore } from "../store/issuesStore";
import { useLGateStore } from "../store/lgateStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import { usePaintModStore } from "../store/paintModStore";
import { useWatchlistStore } from "../store/watchlistStore";
import type { HighlightsLayer } from "./layers/HighlightsLayer";
import type { MapLayer } from "./layers/MapLayer";
import { layerShown } from "./layerVisibility";
import { matchingSystems } from "./matchingSystems";

const EMPTY_MATCH: ReadonlySet<number> = new Set();

/** What a store change moves: the layers, and the camera and context work the controller owns. */
export interface MapView {
  readonly layers: readonly MapLayer[];
  readonly highlights: HighlightsLayer;
  /** Re-reads the stores into a new context and rebuilds every layer from it. */
  rebuild(): void;
  /** The same, unless nothing the layers draw moved. */
  refreshContext(): void;
  syncLayers(): void;
  fit(): void;
  fitSelection(): void;
  focusOn(id: number): void;
  panTo(x: number, y: number): void;
  /** Makes the next tick hand the camera to the layers again. */
  invalidate(): void;
}

/** When a binding applies besides the moment one of the fields it follows changes. */
type Applied = "change" | "bind" | "layers";

interface Binding {
  when: Applied;
  apply?: (view: MapView) => void;
  subscribe: (view: MapView) => () => void;
}

interface Store<S> {
  getState(): S;
  subscribe(listener: (state: S, prev: S) => void): () => void;
}

/** The store fields the map follows, and what each moves when it changes. */
const BINDINGS: Binding[] = [
  watches(useGalaxyStore, (state, prev, view) => {
    if (state.galaxy !== prev.galaxy) {
      view.rebuild();
      view.fit();
    } else if (state.version !== prev.version && state.lastDelta) {
      view.refreshContext();
      applyDelta(view, state.lastDelta);
    } else if (state.hiddenCountries !== prev.hiddenCountries) {
      view.refreshContext();
    }
  }),
  watches(useGameDataStore, (_state, _prev, view) => view.refreshContext()),
  watches(useDetailsStore, (_state, _prev, view) => view.refreshContext()),

  follows(
    useEditorStore,
    [(s) => s.selection],
    (s, view) => view.highlights.setSelection(s.selection),
    "bind",
  ),
  follows(useEditorStore, [(s) => s.hover], (s, view) => view.highlights.setHover(s.hover), "bind"),
  follows(
    useEditorStore,
    [(s) => s.selection],
    (s, view) => pinLabels(view, s.selection),
    "layers",
  ),
  follows(useEditorStore, [(s) => s.hover], (s, view) => setHovered(view, s.hover), "layers"),
  follows(
    useEditorStore,
    [(s) => s.selection],
    (s, view) => setSelection(view, s.selection),
    "layers",
  ),
  follows(
    useEditorStore,
    [(s) => s.selectedLane],
    (s, view) => view.highlights.setSelectedLane(s.selectedLane),
    "bind",
  ),
  follows(
    useEditorStore,
    [(s) => s.selectedNebula],
    (s, view) => setSelectedNebula(view, s.selectedNebula),
    "layers",
  ),
  follows(
    useEditorStore,
    [(s) => s.searchRings],
    (s, view) => view.highlights.setSearched(new Set(s.searchRings)),
    "bind",
  ),
  follows(useEditorStore, [(s) => s.focus], (s, view) => {
    if (s.focus) view.focusOn(s.focus.id);
  }),
  follows(useEditorStore, [(s) => s.pan], (s, view) => {
    if (s.pan) view.panTo(s.pan.x, s.pan.y);
  }),

  follows(
    useMapChromeStore,
    [(s) => s.layers],
    (s, view) => applyLayerVisibility(view, s.layers),
    "layers",
  ),
  follows(useMapChromeStore, [(s) => s.layers], (_s, view) => view.refreshContext()),
  follows(
    useMapChromeStore,
    [(s) => s.lanePreview],
    (s, view) => view.highlights.setLanePreview(s.lanePreview),
    "bind",
  ),
  follows(
    useMapChromeStore,
    [(s) => s.addSystemPreview],
    (s, view) => view.highlights.setAddSystemPreview(s.addSystemPreview),
    "bind",
  ),
  follows(
    useMapChromeStore,
    [(s) => s.shownKinds],
    (s, view) => setShownKinds(view, s.shownKinds),
    "layers",
  ),
  follows(useMapChromeStore, [(s) => s.hiddenInitializers], (_s, view) => view.refreshContext()),
  follows(
    useMapChromeStore,
    [(s) => s.highlightInitializer],
    (s, view) => setMatched(view, s.highlightInitializer),
    "bind",
  ),

  follows(useIssuesStore, [(s) => s.issues], (s, view) => setIssues(view, s.issues), "layers"),
  follows(
    useWatchlistStore,
    [(s) => s.entries, (s) => s.results],
    (s, view) => setWatchlist(view, watchRings(s.entries, s.results)),
    "layers",
  ),
  follows(
    useLGateStore,
    [(s) => s.revealed],
    (s, view) => setLGateRevealed(view, s.revealed),
    "layers",
  ),
  follows(useFileSessionStore, [(s) => s.capabilities], (_s, view) => view.syncLayers()),
  follows(useFileSessionStore, [(s) => s.kind], (_s, view) => {
    view.refreshContext();
    applyLayerVisibility(view, useMapChromeStore.getState().layers);
  }),
  follows(
    useFileSessionStore,
    [(s) => s.painted, (s) => s.paintChosen, (s) => s.path],
    (_s, view) => view.refreshContext(),
  ),
  follows(usePaintModStore, [(s) => s.paintMod], (_s, view) => view.refreshContext()),
];

/** Subscribes the map to every field it follows and applies the ones standing now. */
export function bindViewState(view: MapView): () => void {
  const offs = BINDINGS.map((binding) => {
    if (binding.when !== "change") binding.apply?.(view);
    return binding.subscribe(view);
  });
  return () => {
    for (const off of offs) off();
  };
}

/** Hands a freshly made set of layers the view state the standing ones hold. */
export function dressLayers(view: MapView): void {
  for (const binding of BINDINGS) {
    if (binding.when === "layers") binding.apply?.(view);
  }
}

function follows<S>(
  store: Store<S>,
  fields: ReadonlyArray<(state: S) => unknown>,
  apply: (state: S, view: MapView) => void,
  when: Applied = "change",
): Binding {
  return {
    when,
    apply: (view) => apply(store.getState(), view),
    subscribe: (view) =>
      store.subscribe((state, prev) => {
        if (fields.some((field) => field(state) !== field(prev))) apply(state, view);
      }),
  };
}

/** For a store whose fields are read together, such as the three shapes a galaxy change takes. */
function watches<S>(store: Store<S>, listen: (state: S, prev: S, view: MapView) => void): Binding {
  return {
    when: "change",
    subscribe: (view) => store.subscribe((state, prev) => listen(state, prev, view)),
  };
}

function applyDelta(view: MapView, delta: GalaxyDelta): void {
  for (const layer of view.layers) layer.applyDelta(delta);
  view.invalidate();
}

function pinLabels(view: MapView, selection: number[]): void {
  for (const layer of view.layers) layer.setPinned?.(selection);
  view.invalidate();
}

function setHovered(view: MapView, id: number | null): void {
  for (const layer of view.layers) layer.setHovered?.(id);
}

function setSelection(view: MapView, ids: readonly number[]): void {
  for (const layer of view.layers) layer.setSelection?.(ids);
}

function setShownKinds(view: MapView, kinds: ReadonlySet<SpecialKind>): void {
  for (const layer of view.layers) layer.setShownKinds?.(kinds);
}

function setSelectedNebula(view: MapView, index: number | null): void {
  for (const layer of view.layers) layer.setSelectedNebula?.(index);
}

function setIssues(view: MapView, issues: readonly AppIssue[]): void {
  for (const layer of view.layers) layer.setIssues?.(issues);
}

function setWatchlist(view: MapView, rings: readonly WatchRings[]): void {
  for (const layer of view.layers) layer.setWatchlist?.(rings);
  view.invalidate();
}

function setLGateRevealed(view: MapView, revealed: boolean): void {
  for (const layer of view.layers) layer.setLGateRevealed?.(revealed);
  view.invalidate();
}

function setMatched(view: MapView, key: string | null): void {
  const ids = key === null ? EMPTY_MATCH : matchingSystems(useGalaxyStore.getState().systems, key);
  view.highlights.setMatched(ids);
}

function applyLayerVisibility(view: MapView, layers: Record<LayerId, boolean>): void {
  const kind = useFileSessionStore.getState().kind;
  for (const layer of view.layers) {
    layer.setVisible(layerShown(layer.id, layers, kind));
    layer.setDetailsShown?.(layers.details ?? true);
    layer.setClansShown?.(layers.marauders ?? true);
  }
  view.invalidate();
}
