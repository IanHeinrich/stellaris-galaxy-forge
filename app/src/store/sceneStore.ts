import { create } from "zustand";
import { documentCapabilities, type CapabilitySource } from "../lib/capabilities";
import { renumberedId, type Renumbering } from "../lib/renumber";
import { barModeOf, type BarMode } from "../lib/visual/barMode";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";

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
  /** Shows system `id`; `bindStores` selects it and clears the galaxy's tool, menu and overlays. */
  enterSystem(id: number): void;
  /** Back to the galaxy, leaving the inspector as it is; `backToGalaxy` is the user's way out. */
  exitScene(): void;
  /** Follows an edit that renumbered the system shown; one it removed leaves the scene. */
  renumber(pairs: Renumbering): void;
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
  return !documentCapabilities(session).details;
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
}));
