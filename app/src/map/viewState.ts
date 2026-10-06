import type { GalaxyDelta } from "../generated/GalaxyDelta";
import type { PreparedMap } from "../generated/PreparedMap";
import type { SpecialKind } from "../generated/SpecialKind";
import type { HeightPreview } from "../lib/height";
import type { AppIssue } from "../lib/issues";
import type { Outcome } from "../lib/prepareCopy";
import { documentCapabilities } from "../lib/capabilities";
import type { GalaxyLayers } from "../lib/visual/layerIds";
import { shownTilt } from "../lib/visual/tilt";
import { watchRings, type WatchRings } from "../lib/watchlist";
import { useDetailsStore } from "../store/detailsStore";
import { useEditorStore } from "../store/editorStore";
import { useFileSessionStore } from "../store/fileSessionStore";
import { useGalaxyStore } from "../store/galaxyStore";
import { useGameDataStore } from "../store/gameDataStore";
import { useHeightPreviewStore } from "../store/heightPreviewStore";
import { useIssuesStore } from "../store/issuesStore";
import { useLGateStore } from "../store/lgateStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import { usePaintModStore } from "../store/paintModStore";
import { usePlanetMoveStore } from "../store/planetMoveStore";
import { mapInputs } from "../store/preparedMap";
import {
  ringedSystems,
  shownProjection,
  systemOutcomes,
  usePrepareStore,
} from "../store/prepareStore";
import { useToolStore } from "../store/toolStore";
import { useWatchlistStore } from "../store/watchlistStore";
import { follows, type Binding, type Store } from "./follows";
import type { HighlightsLayer } from "./layers/HighlightsLayer";
import type { MapLayer } from "./layers/MapLayer";
import { layerShown } from "./layerVisibility";
import { matchingSystems } from "./matchingSystems";

const EMPTY_MATCH: ReadonlySet<number> = new Set();
const NO_OUTCOME: ReadonlyMap<number, Outcome> = new Map();
const NO_ISSUES: readonly AppIssue[] = [];

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
  /** Leans the map `degrees` away from the viewer, or lays it flat at 0. */
  setTilt(degrees: number): void;
  /** Shows the heights the inspector previews, from the next frame. */
  previewHeights(preview: HeightPreview): void;
  /** Makes the next tick hand the camera to the layers again. */
  invalidate(): void;
}

/** When a binding applies besides a change: as the map binds, or as a new set of layers is made. */
type Applied = "bind" | "layers";

/** The store fields the map follows, and what each moves when it changes. */
const BINDINGS: Array<Binding<MapView, Applied>> = [
  watches(useGalaxyStore, (state, prev, view) => {
    if (state.galaxy !== prev.galaxy) {
      view.rebuild();
      view.fit();
    } else if (state.version !== prev.version && state.lastDelta) {
      view.refreshContext();
      applyDelta(view, shownDelta(state.lastDelta));
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
  follows(useToolStore, [(s) => s.tilt], (_s, view) => applyTilt(view), "bind"),
  follows(
    useHeightPreviewStore,
    [(s) => s.preview],
    (s, view) => view.previewHeights(s.preview),
    "bind",
  ),
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
  follows(useMapChromeStore, [(s) => s.hiddenPrecursors], (_s, view) => view.refreshContext()),
  follows(
    useMapChromeStore,
    [(s) => s.highlightInitializer],
    (s, view) => setMatched(view, s.highlightInitializer),
    "bind",
  ),

  follows(
    usePrepareStore,
    [(s) => s.hovered, (s) => s.preview],
    (s, view) =>
      view.highlights.setPrepared(new Set(ringedSystems(s)), s.hovered === "fallen_empires"),
    "bind",
  ),
  follows(
    usePrepareStore,
    [(s) => s.outcomeShown, (s) => s.preview, (s) => s.choices],
    (s, view) => setOutcome(view, s.outcomeShown ? systemOutcomes(s) : NO_OUTCOME),
    "layers",
  ),
  watches(usePrepareStore, (state, prev, view) => {
    const before = shownProjection(prev);
    const after = shownProjection(state);
    if (before !== after) showProjection(view, before, after);
  }),

  follows(
    usePlanetMoveStore,
    [(s) => s.cut],
    (s, view) => view.highlights.setCutSource(s.cut?.from ?? null),
    "bind",
  ),

  follows(
    useIssuesStore,
    [(s) => s.issues],
    (_s, view) => setIssues(view, shownIssues()),
    "layers",
  ),
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
  follows(useFileSessionStore, [(s) => s.capabilities], (_s, view) => {
    view.syncLayers();
    applyTilt(view);
  }),
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

/** For a store whose fields are read together, such as the three shapes a galaxy change takes. */
function watches<S>(
  store: Store<S>,
  listen: (state: S, prev: S, view: MapView) => void,
): Binding<MapView, Applied> {
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

/** The issues the map marks: none while it shows the map as Prepare's choices would leave it. */
function shownIssues(): readonly AppIssue[] {
  return shownProjection(usePrepareStore.getState()) ? NO_ISSUES : useIssuesStore.getState().issues;
}

/**
 * `delta` with each system as the map shows it, so a system Prepare's choices rewrite keeps the
 * look they give it.
 */
function shownDelta(delta: GalaxyDelta): GalaxyDelta {
  const { systems } = mapInputs();
  return { ...delta, systems: delta.systems.flatMap((node) => systems.get(node.id) ?? []) };
}

/**
 * Swaps the map between the document and the map as Prepare's choices would leave it. The layers
 * that redraw one system at a time are handed each system either projection rewrites.
 */
function showProjection(
  view: MapView,
  before: PreparedMap | null,
  after: PreparedMap | null,
): void {
  view.refreshContext();
  const nodes = new Map(
    [...(before?.systems ?? []), ...(after?.systems ?? [])].map((s) => [s.id, s]),
  );
  applyDelta(view, shownDelta({ systems: [...nodes.values()] }));
  setIssues(view, shownIssues());
}

function setWatchlist(view: MapView, rings: readonly WatchRings[]): void {
  for (const layer of view.layers) layer.setWatchlist?.(rings);
  view.invalidate();
}

function setOutcome(view: MapView, outcomes: ReadonlyMap<number, Outcome>): void {
  for (const layer of view.layers) layer.setOutcome?.(outcomes);
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

function applyLayerVisibility(view: MapView, layers: GalaxyLayers): void {
  const capabilities = documentCapabilities(useFileSessionStore.getState());
  for (const layer of view.layers) {
    layer.setVisible(layerShown(layer.id, layers, capabilities));
    layer.setDetailsShown?.(layers.details ?? true);
    layer.setClansShown?.(layers.marauders ?? true);
  }
  view.invalidate();
}

/** The tilt the slider asks for, where the open document lets the map lean. */
function applyTilt(view: MapView): void {
  const capabilities = documentCapabilities(useFileSessionStore.getState());
  view.setTilt(shownTilt(useToolStore.getState().tilt, capabilities));
}
