/**
 * The Add megastructure dialog: where in the system view it was opened, what goes there, the
 * picks of a whole ring world and what clearing its system takes, and the add itself, which opens
 * the new row's page once the edit lands.
 */
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AddSpot } from "../generated/AddSpot";
import type { RingStage } from "../generated/RingStage";
import type { RingWorldClearing } from "../generated/RingWorldClearing";
import { megastructureLabel } from "../lib/details/labels";
import { leftOutNotice, MEGASTRUCTURES_NEED_GAME_DATA, NOT_PLACED } from "../lib/megastructureCopy";
import {
  fitsByKind,
  placeOf,
  type MegastructureFits,
  type MegastructureSpot,
} from "../lib/megastructurePicks";
import { ALL_FINISHED } from "../lib/ringWorldAdd";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
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
  /** What goes at the prompt's spot, by type, as the shell answered; null until read. */
  fits: MegastructureFits | null;
  /**
   * The game data's version and the generation of the prompt's system, as `useOpCheckStore`
   * counts its edits, that `fits` were asked at or are being asked at; null before the dialog
   * asks, and after a read that failed.
   */
  fitsAt: string | null;
  /** Why what goes at the spot couldn't be read. */
  fitsError: string | null;
  /** The stage added last, which the dialog opens on next where it goes. */
  last: string | null;
  /** The stage each quadrant of a whole ring world is added at, A to D; all finished on opening. */
  ringStages: readonly RingStage[];
  /** The ring world type of the ring world size picked; null for the first size, as on opening. */
  ringSize: string | null;
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
  /**
   * Picks the ring world size whose ring world type is `ring`, whose quadrants are offered at
   * `offered`: a quadrant at any other stage goes back to finished.
   */
  setRingSize(ring: string, offered: readonly RingStage[]): void;
  setRingClear(clear: boolean): void;
  setKeepPlanet(keep: boolean): void;
  /**
   * Asks the shell what goes at the dialog's spot, its system at `generation` and the game data
   * as loaded now, unless that has been asked already. An answer for another opening, an older
   * generation or other game data is dropped, and a failed read is asked again.
   */
  loadFits(generation: number): Promise<void>;
  /** Reads what clearing the dialog's system takes, once per opening. */
  loadClearing(): Promise<void>;
  /**
   * Closes the dialog and adds a finished megastructure of type `kind` at its spot in one edit;
   * it goes to the system's owner. `stage` is the stage the player picked, which the dialog opens
   * on next; it differs from `kind` when the game swaps the stage for another type at the spot.
   * The row stands where the spot's fits place `kind`, and nothing is added before they are
   * read. The new row's page opens, and the status bar says how many effects of its
   * construction were left out, when any were. The planet changes class or size as the type's
   * build changes it, unless the dialog keeps it. A type whose finished stage is a habitat adds
   * the habitat round the body as a planet instead, and selects it with its page open.
   */
  add(kind: string, stage?: string): Promise<boolean>;
  /**
   * Closes the dialog and adds the ring world of type `kind`'s chain whole round its system's
   * star in one edit, each quadrant at its picked stage, owned by the system's owner, clearing
   * the system first when picked. `stage` is the Ring tile picked, which the dialog opens on
   * next; it differs from `kind` for a size other than the first.
   */
  addRing(kind: string, stage?: string): Promise<boolean>;
}

const CLOSED = {
  prompt: null,
  fits: null,
  fitsAt: null,
  fitsError: null,
  clearingFor: null,
  clearing: null,
  clearingError: null,
} as const;

/** The spot as the shell takes it. */
function addSpot(spot: MegastructureSpot): AddSpot {
  return spot.kind === "body" ? { kind: "body", body: spot.body } : spot;
}

export const useMegastructureAddStore = create<MegastructureAddState>((set, get) => ({
  ...CLOSED,
  last: null,
  ringStages: ALL_FINISHED,
  ringSize: null,
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
      ringSize: null,
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

  setRingSize(ring, offered) {
    const ringStages = get().ringStages.map((at) => (offered.includes(at) ? at : "finished"));
    set({ ringSize: ring, ringStages });
  },

  setRingClear(clear) {
    set({ ringClear: clear });
  },

  setKeepPlanet(keep) {
    set({ keepPlanet: keep });
  },

  async loadFits(generation) {
    const { prompt, fitsAt } = get();
    const at = `${useGameDataStore.getState().version}:${generation}`;
    if (prompt === null || fitsAt === at) return;
    set({ fitsAt: at, fitsError: null });
    const current = () => get().prompt === prompt && get().fitsAt === at;
    try {
      const fits = fitsByKind(await ipc.getMegastructureFits(prompt.system, addSpot(prompt.spot)));
      if (current()) set({ fits });
    } catch (e) {
      if (current()) set({ fitsAt: null, fitsError: ipc.errorMessage(e) });
    }
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

  async addRing(kind, stage = kind) {
    const { prompt, ringStages, ringClear } = get();
    if (prompt === null) return false;
    set(CLOSED);
    const editor = useEditorStore.getState();
    const added = await editor.addRingWorld(prompt.system, kind, ringStages, ringClear);
    if (added === null) return false;
    set({ last: stage });
    return true;
  },

  async add(kind, stage = kind) {
    const { prompt, keepPlanet, fits } = get();
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
    const at = fits === null ? null : placeOf(fits, kind);
    if (at === null) {
      useFileSessionStore.getState().setError(NOT_PLACED);
      return false;
    }
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
