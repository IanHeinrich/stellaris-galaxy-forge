/**
 * The Add ambient object browser: where in the system view it was opened, and the add, which
 * opens the new object's page once the edit lands.
 */
import { create } from "zustand";
import { ambientObjectName, AMBIENT_OBJECTS_NEED_GAME_DATA } from "../lib/ambientObjectAdd";
import { aboutMainStar, mainStarPoint } from "../lib/details/ambientObjects";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { ambientObjectEntry, useInspectorStore } from "./inspectorStore";
import { systemGeometry } from "./systemGeometry";

/** Where the browser adds: a point of system `system`'s view, about its centre. */
export interface AmbientObjectAddPrompt {
  system: number;
  x: number;
  y: number;
}

interface AmbientObjectAddState {
  prompt: AmbientObjectAddPrompt | null;
  /** The type added last, which the browser opens on next. */
  last: string | null;
  /**
   * Opens the browser at point (`x`, `y`) of system `system`, and reads the ambient objects if
   * they are not yet read; without game data, says why not instead.
   */
  open(system: number, x: number, y: number): boolean;
  cancel(): void;
  /**
   * Closes the browser and adds an ambient object of type `kind` at its point, measured from the
   * system's main star as the game places it, in one edit. The new object's page opens.
   */
  add(kind: string): Promise<boolean>;
}

export const useAmbientObjectAddStore = create<AmbientObjectAddState>((set, get) => ({
  prompt: null,
  last: null,

  open(system, x, y) {
    const data = useGameDataStore.getState();
    if (data.status !== "ready") {
      useFileSessionStore.getState().setError(AMBIENT_OBJECTS_NEED_GAME_DATA);
      return false;
    }
    set({ prompt: { system, x, y } });
    void data.loadAmbientObjects();
    return true;
  },

  cancel() {
    if (get().prompt !== null) set({ prompt: null });
  },

  async add(kind) {
    const { prompt } = get();
    if (prompt === null) return false;
    set({ prompt: null });
    const { system } = prompt;
    const id = await useEditorStore.getState().addAmbientObject(system, kind, () => {
      const { frame } = systemGeometry(system);
      return aboutMainStar(prompt, mainStarPoint(frame.layout, frame.details));
    });
    if (id === null) return false;
    set({ last: kind });
    const name = ambientObjectName(kind, useGameDataStore.getState().ambientObjects);
    useInspectorStore.getState().openFromMap(ambientObjectEntry(system, id, name));
    return true;
  },
}));
