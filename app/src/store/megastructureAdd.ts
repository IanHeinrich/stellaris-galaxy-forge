/**
 * The Add megastructure dialog: where in the system view it was opened, the picks of a whole ring
 * world and what clearing its system takes, and the add itself, which opens the new row's page
 * once the edit lands.
 */
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";
import { megastructureLabel } from "../lib/details/labels";
import {
  leftOutNotice,
  MEGASTRUCTURES_NEED_GAME_DATA,
  megastructurePlace,
  type MegastructureSpot,
} from "../lib/megastructurePicks";
import { ALL_FINISHED } from "../lib/ringWorldAdd";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { megastructureEntry, useInspectorStore } from "./inspectorStore";
import { useSceneStore } from "./sceneStore";

/** Where the dialog adds: a spot of system `system`'s view. */
export interface MegastructureAddPrompt {
  system: number;
  spot: MegastructureSpot;
}

interface MegastructureAddState {
  prompt: MegastructureAddPrompt | null;
  /** The stage added last, which the dialog opens on next where it goes. */
  last: string | null;
  /** The stage each quadrant of a whole ring world is added at, A to D; all finished on opening. */
  ringStages: readonly RingStage[];
  /** A whole ring world clears the system first, as the game's frame does; off on opening. */
  ringClear: boolean;
  /** The system whose clearing is read, or being read; null before the Ring tile asks. */
  clearingFor: number | null;
  /**
   * The add leaves the planet's class and size alone, where the type's build would change them;
   * off on opening, so the planet changes as the game changes it.
   */
  keepPlanet: boolean;
  /** What clearing the system takes, once read. */
  clearing: RingWorldClearing | null;
  /** Why what clearing takes couldn't be read. */
  clearingError: string | null;
  /** Opens the dialog for `spot` of system `system`; without game data, says why not instead. */
  open(system: number, spot: MegastructureSpot): boolean;
  cancel(): void;
  /** Sets quadrant `quadrant`, 0 for A, to `stage`. */
  setRingStage(quadrant: number, stage: RingStage): void;
  /** Sets every quadrant to `stage`. */
  setRingStages(stage: RingStage): void;
  setRingClear(clear: boolean): void;
  setKeepPlanet(keep: boolean): void;
  /** Reads what clearing the dialog's system takes, once per opening. */
  loadClearing(): Promise<void>;
  /**
   * Closes the dialog and adds a finished megastructure of type `kind` at its spot in one edit;
   * it goes to the system's owner. `stage` is the stage the player picked, which the dialog opens
   * on next; it differs from `kind` when the game swaps the stage for another type at the spot. A
   * type built outside the gravity well stands just outside the system's inner radius, in the
   * direction pressed. The new row's page opens, and the status bar says how many effects of its
   * construction were left out, when any were. The planet changes class or size as the type's
   * build changes it, unless the dialog keeps it. A type whose finished stage is a habitat adds
   * the habitat round the body as a planet instead, and selects it with its page open.
   */
  add(kind: string, stage?: string): Promise<boolean>;
  /**
   * Closes the dialog and adds the ring world of type `kind`'s chain whole round its system's
   * star in one edit, each quadrant at its picked stage, owned by the system's owner, clearing
   * the system first when picked. `kind` is remembered as the stage the dialog opens on next.
   */
  addRing(kind: string): Promise<boolean>;
}

const CLOSED = { prompt: null, clearingFor: null, clearing: null, clearingError: null } as const;

export const useMegastructureAddStore = create<MegastructureAddState>((set, get) => ({
  ...CLOSED,
  last: null,
  ringStages: ALL_FINISHED,
  ringClear: false,
  keepPlanet: false,

  open(system, spot) {
    if (useGameDataStore.getState().status !== "ready") {
      useFileSessionStore.getState().setError(MEGASTRUCTURES_NEED_GAME_DATA);
      return false;
    }
    set({
      ...CLOSED,
      prompt: { system, spot },
      ringStages: ALL_FINISHED,
      ringClear: false,
      keepPlanet: false,
    });
    return true;
  },

  cancel() {
    if (get().prompt !== null) set(CLOSED);
  },

  setRingStage(quadrant, stage) {
    set({ ringStages: get().ringStages.map((at, i) => (i === quadrant ? stage : at)) });
  },

  setRingStages(stage) {
    set({ ringStages: get().ringStages.map(() => stage) });
  },

  setRingClear(clear) {
    set({ ringClear: clear });
  },

  setKeepPlanet(keep) {
    set({ keepPlanet: keep });
  },

  async loadClearing() {
    const { prompt, clearingFor } = get();
    if (prompt === null || clearingFor === prompt.system) return;
    const { system } = prompt;
    set({ clearingFor: system, clearing: null, clearingError: null });
    try {
      const clearing = await ipc.getRingWorldClearing(system);
      if (get().clearingFor === system) set({ clearing });
    } catch (e) {
      if (get().clearingFor === system) set({ clearingError: ipc.errorMessage(e) });
    }
  },

  async addRing(kind) {
    const { prompt, ringStages, ringClear } = get();
    if (prompt === null) return false;
    set(CLOSED);
    const { system } = prompt;
    const owner = useGalaxyStore.getState().systems.get(system)?.owner ?? null;
    const editor = useEditorStore.getState();
    const added = await editor.addRingWorld(system, kind, ringStages, owner, ringClear);
    if (added === null) return false;
    set({ last: kind });
    return true;
  },

  async add(kind, stage = kind) {
    const { prompt, keepPlanet } = get();
    if (prompt === null) return false;
    set(CLOSED);
    const { system, spot } = prompt;
    const data = useGameDataStore.getState();
    if (data.megastructureTypes.get(kind)?.habitat === true && spot.kind === "body") {
      const planet = await useEditorStore.getState().addHabitat(system, spot.body, kind);
      if (planet === null) return false;
      set({ last: stage });
      useSceneStore.getState().showBody(system, planet);
      return true;
    }
    const inner = useDetailsStore.getState().details.get(system)?.inner_radius ?? 0;
    const at = megastructurePlace(spot, data.megastructureTypes.get(kind), inner);
    const added = await useEditorStore.getState().addMegastructure(system, kind, at, keepPlanet);
    if (added === null) return false;
    set({ last: stage });
    const name = data.names.get(kind) ?? megastructureLabel(kind);
    useInspectorStore.getState().openFromMap(megastructureEntry(added.megastructure, name));
    const notice = leftOutNotice(name, added.unsure.length, added.unwritten.length);
    if (notice !== null) useFileSessionStore.getState().setNotice(notice);
    return true;
  },
}));
