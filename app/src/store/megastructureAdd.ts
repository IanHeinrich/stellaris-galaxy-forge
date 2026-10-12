/**
 * The Add megastructure dialog: where in the system view it was opened, and the add itself, which
 * opens the new row's page once the edit lands.
 */
import { create } from "zustand";
import { megastructureLabel } from "../lib/details/labels";
import {
  leftOutNotice,
  MEGASTRUCTURES_NEED_GAME_DATA,
  megastructurePlace,
  type MegastructureSpot,
} from "../lib/megastructurePicks";
import { useDetailsStore } from "./detailsStore";
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
  /** The stage added last, which the dialog opens on next where it goes. */
  last: string | null;
  /** Opens the dialog for `spot` of system `system`; without game data, says why not instead. */
  open(system: number, spot: MegastructureSpot): boolean;
  cancel(): void;
  /**
   * Closes the dialog and adds a finished megastructure of type `kind` at its spot in one edit;
   * it goes to the system's owner. `stage` is the stage the player picked, which the dialog opens
   * on next; it differs from `kind` when the game swaps the stage for another type at the spot. A
   * type built outside the gravity well stands just outside the system's inner radius, in the
   * direction pressed. The new row's page opens, and the status bar says how many effects of its
   * construction were left out, when any were. A type whose finished stage is a habitat adds
   * the habitat round the body as a planet instead, and selects it with its page open.
   */
  add(kind: string, stage?: string): Promise<boolean>;
}

export const useMegastructureAddStore = create<MegastructureAddState>((set, get) => ({
  prompt: null,
  last: null,

  open(system, spot) {
    if (useGameDataStore.getState().status !== "ready") {
      useFileSessionStore.getState().setError(MEGASTRUCTURES_NEED_GAME_DATA);
      return false;
    }
    set({ prompt: { system, spot } });
    return true;
  },

  cancel() {
    if (get().prompt !== null) set({ prompt: null });
  },

  async add(kind, stage = kind) {
    const { prompt } = get();
    if (prompt === null) return false;
    set({ prompt: null });
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
    const added = await useEditorStore.getState().addMegastructure(system, kind, at);
    if (added === null) return false;
    set({ last: stage });
    const name = data.names.get(kind) ?? megastructureLabel(kind);
    useInspectorStore.getState().openFromMap(megastructureEntry(added.megastructure, name));
    const notice = leftOutNotice(name, added.unsure.length, added.unwritten.length);
    if (notice !== null) useFileSessionStore.getState().setNotice(notice);
    return true;
  },
}));
