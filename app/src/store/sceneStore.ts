import { create } from "zustand";
import { documentCapabilities, type CapabilitySource } from "../lib/capabilities";
import { renumberedId, type Renumbering } from "../lib/renumber";
import { barModeOf, type BarMode } from "../lib/visual/barMode";
import { bodyName } from "../lib/details/labels";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { bodyEntry, useInspectorStore } from "./inspectorStore";

/**
 * The bodies selected in one system's view, in the order they were picked. A selection of one
 * body is always the body whose page the inspector shows in the system view.
 */
export interface BodySelection {
  system: number;
  ids: readonly number[];
}

/** What the map shows: the whole galaxy, or one system's bodies. */
export type Scene = { kind: "galaxy" } | { kind: "system"; id: number };

export const GALAXY_SCENE: Scene = { kind: "galaxy" };

export interface SceneState {
  scene: Scene;
  /**
   * Counts the systems entered, so a follower can tell entering a system from an edit
   * renumbering the one shown.
   */
  visit: number;
  /** Which roll of a scenario system's initializer the system view draws; 0 on entering one. */
  roll: number;
  /** Draws the scenario system shown as another roll of its initializer. */
  rollAgain(): void;
  /** The body a panel's link names while the pointer is on the link; the system view brightens it. */
  linkedBody: number | null;
  setLinkedBody(id: number | null): void;
  /**
   * The bodies a drag keeps about what they orbit, by id: a view setting of the open document,
   * never an edit. Opening or closing a document, or an edit that renumbers systems, drops them,
   * and `bindStores` drops one once the details that held its body refresh without it.
   */
  lockedBodies: ReadonlySet<number>;
  lockBody(id: number): void;
  unlockBody(id: number): void;
  clearLocks(): void;
  /** The body the system view last asked to be centred on; the nonce tells one ask from the next. */
  bodyFocus: { id: number; nonce: number } | null;
  /** Centres the system view on body `id` of the system shown, once its layout places it. */
  focusBody(id: number): void;
  /** Shows system `id`; `bindStores` selects it and clears the galaxy's tool, menu and overlays. */
  enterSystem(id: number): void;
  /** Back to the galaxy, leaving the inspector as it is; `backToGalaxy` is the user's way out. */
  exitScene(): void;
  /** Follows an edit that renumbered the system shown; one it removed leaves the scene. */
  renumber(pairs: Renumbering): void;
  /** The bodies selected in the system view; null with none. */
  bodySelection: BodySelection | null;
  /** Selects `ids` of `system`, or nothing; the caller opens any page. */
  selectBodies(selection: BodySelection | null): void;
  /** Selects body `id` of `system` alone; the caller opens its page. */
  selectBody(system: number, id: number): void;
  /** Selects body `id` of `system` alone, with its page open. */
  showBody(system: number, id: number): void;
  /**
   * Adds body `id` to the selection, or takes it out. A body of another system starts a new
   * selection, and so does any toggle on a document whose planets cannot move. When one body is
   * left it opens that body's page and returns its id; when none is, the inspector goes back to
   * the system.
   */
  toggleBody(system: number, id: number): number | null;
  clearBodies(): void;
  /** Keeps only the selected bodies `present` says are still in the selection's system. */
  keepBodies(present: (id: number) => boolean): void;
  /** Makes a selection of one body or none the body whose page the inspector shows, if any. */
  followInspector(): void;
}

/** The body of the system shown whose page is on top of the inspector, or null. */
function inspectedBody(): { system: number; id: number } | null {
  const shown = sceneSystem();
  if (shown === null) return null;
  const { stack } = useInspectorStore.getState();
  const { ref } = stack[stack.length - 1];
  if (ref.kind === "body") return ref.system === shown ? { system: shown, id: ref.id } : null;
  if (ref.kind !== "planet") return null;
  const read = useDetailsStore.getState().details.get(shown);
  if (read !== undefined && !read.planets.some((p) => p.id === ref.id)) return null;
  return { system: shown, id: ref.id };
}

/** Opens the page of body `id` of `system` above the system's, named as its read details name it. */
function openBodyPage(system: number, id: number): void {
  const planet = useDetailsStore
    .getState()
    .details.get(system)
    ?.planets.find((p) => p.id === id);
  const label = planet ? bodyName(planet, useGameDataStore.getState().names) : `#${id}`;
  useInspectorStore.getState().openFromMap(bodyEntry(system, id, label));
}

/** The system the map shows, or null while it shows the galaxy. */
export function sceneSystem(): number | null {
  return shownSystem(useSceneStore.getState());
}

function shownSystem({ scene }: Pick<SceneState, "scene">): number | null {
  return scene.kind === "system" ? scene.id : null;
}

/** The system the map shows, as a component reads it. */
export function useSceneSystem(): number | null {
  return useSceneStore(shownSystem);
}

/** The bar the chrome shows now, for the commands that run outside React. */
export function currentBarMode(): BarMode {
  return barModeOf(useFileSessionStore.getState().kind, sceneSystem() !== null);
}

/** The bar the chrome shows, as a component reads it. */
export function useBarMode(): BarMode {
  const kind = useFileSessionStore((s) => s.kind);
  const inSystem = useSceneSystem() !== null;
  return barModeOf(kind, inSystem);
}

/** Whether the document draws its systems as rolls of their initializers: it has no bodies of its own. */
function rollsSystems(session: CapabilitySource): boolean {
  return documentCapabilities(session).rolled_layout;
}

/** Whether Roll again has anything to do: a rolled system is shown. */
function canRollAgain(): boolean {
  return sceneSystem() !== null && rollsSystems(useFileSessionStore.getState());
}

/** Whether Roll again has anything to do, as a component reads it. */
export function useCanRollAgain(): boolean {
  const inSystem = useSceneSystem() !== null;
  const rolled = useFileSessionStore(rollsSystems);
  return inSystem && rolled;
}

/** Whether the enter routes offer a system scene: on any open document, save or scenario. */
export function canEnterSystem(): boolean {
  return useFileSessionStore.getState().status === "ready";
}

const NO_LOCKS: ReadonlySet<number> = new Set();

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: GALAXY_SCENE,
  visit: 0,
  roll: 0,
  linkedBody: null,
  lockedBodies: NO_LOCKS,
  bodyFocus: null,

  rollAgain() {
    if (!canRollAgain()) return;
    set({ roll: get().roll + 1 });
  },

  setLinkedBody(id) {
    if (get().linkedBody !== id) set({ linkedBody: id });
  },

  lockBody(id) {
    const { lockedBodies } = get();
    if (!lockedBodies.has(id)) set({ lockedBodies: new Set([...lockedBodies, id]) });
  },

  unlockBody(id) {
    const { lockedBodies } = get();
    if (!lockedBodies.has(id)) return;
    const next = new Set(lockedBodies);
    next.delete(id);
    set({ lockedBodies: next });
  },

  clearLocks() {
    if (get().lockedBodies.size > 0) set({ lockedBodies: NO_LOCKS });
  },

  focusBody(id) {
    set({ bodyFocus: { id, nonce: (get().bodyFocus?.nonce ?? 0) + 1 } });
  },

  enterSystem(id) {
    if (!useGalaxyStore.getState().systems.has(id)) return;
    set({ scene: { kind: "system", id }, visit: get().visit + 1, roll: 0, linkedBody: null });
  },

  exitScene() {
    if (get().scene.kind === "galaxy") return;
    set({ scene: GALAXY_SCENE, roll: 0, linkedBody: null });
  },

  renumber(pairs) {
    if (pairs.length > 0) get().clearLocks();
    const { scene } = get();
    if (scene.kind !== "system") return;
    const id = renumberedId(pairs, scene.id);
    if (id === scene.id) return;
    if (id === null) get().exitScene();
    else set({ scene: { kind: "system", id } });
  },

  bodySelection: null,

  selectBodies(selection) {
    set({ bodySelection: selection });
  },

  selectBody(system, id) {
    get().selectBodies({ system, ids: [id] });
  },

  showBody(system, id) {
    get().selectBody(system, id);
    openBodyPage(system, id);
  },

  toggleBody(system, id) {
    const selection = get().bodySelection;
    const ids =
      selection === null ||
      selection.system !== system ||
      !documentCapabilities(useFileSessionStore.getState()).planet_moves
        ? [id]
        : selection.ids.includes(id)
          ? selection.ids.filter((b) => b !== id)
          : [...selection.ids, id];
    if (ids.length === 1) {
      get().showBody(system, ids[0]);
      return ids[0];
    }
    get().selectBodies(ids.length === 0 ? null : { system, ids });
    if (ids.length === 0) useInspectorStore.getState().popTo(0);
    return null;
  },

  clearBodies() {
    if (get().bodySelection !== null) get().selectBodies(null);
  },

  keepBodies(present) {
    const selection = get().bodySelection;
    if (selection === null) return;
    const ids = selection.ids.filter(present);
    if (ids.length === selection.ids.length) return;
    get().selectBodies(ids.length > 1 ? { system: selection.system, ids } : null);
    get().followInspector();
  },

  followInspector() {
    const selection = get().bodySelection;
    if (selection !== null && selection.ids.length > 1) return;
    const body = inspectedBody();
    if (body === null) {
      if (selection !== null) get().selectBodies(null);
      return;
    }
    if (selection?.system === body.system && selection.ids[0] === body.id) return;
    get().selectBody(body.system, body.id);
  },
}));
