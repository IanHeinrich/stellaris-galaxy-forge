import { confirm } from "@tauri-apps/plugin-dialog";
import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import { nodeName } from "../lib/names";
import { counted } from "../lib/text";
import type { RunEdit } from "./editorEdits";
import type { EditorState } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { PREF_KEYS } from "./prefKeys";
import { isFiniteNumber, prefField } from "./prefs";

/** The radius a new nebula gets on a profile that has never made one. */
export const DEFAULT_NEBULA_RADIUS = 30;

const NEBULA_RADIUS = prefField(PREF_KEYS.nebulaRadius, DEFAULT_NEBULA_RADIUS, isFiniteNumber);

type NebulaActions = Pick<
  EditorState,
  | "lastNebulaRadius"
  | "moveNebula"
  | "addNebulaAt"
  | "promptNebulaAt"
  | "cancelNebulaPrompt"
  | "createPromptedNebula"
  | "setNebulaRadius"
  | "setNebulaName"
  | "removeNebula"
>;

export function nebulaActions(
  set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): NebulaActions {
  return {
    lastNebulaRadius: NEBULA_RADIUS.read(),

    async moveNebula(index, x, y) {
      await get().applyOp({ type: "MoveNebula", index, x, y });
    },

    async addNebulaAt(x, y, radius = get().lastNebulaRadius, name = null) {
      const result = await runEdit(() => ipc.applyOp({ type: "AddNebula", x, y, radius, name }));
      if (result === null) return false;
      set({ lastNebulaRadius: radius });
      NEBULA_RADIUS.save(radius);
      // A cloud nobody can see is a cloud nobody can edit.
      useMapChromeStore.getState().setLayerQuietly("nebulae", true);
      // A new nebula always lands last, so it is the last of the list its own edit left behind.
      const nebulae = result.delta.nebulae ?? useGalaxyStore.getState().nebulae;
      get().selectNebula(nebulae.length - 1);
      return true;
    },

    promptNebulaAt(x, y) {
      set({ nebulaPrompt: { x, y } });
    },

    cancelNebulaPrompt() {
      if (get().nebulaPrompt) set({ nebulaPrompt: null });
    },

    async createPromptedNebula(name) {
      const at = get().nebulaPrompt;
      const named = name.trim();
      // The label is the handle the cloud is dragged by, so it is named before it exists.
      if (!at || named === "") return false;
      // A refused op leaves the prompt standing with the point and the name still in it.
      if (!(await get().addNebulaAt(at.x, at.y, undefined, named))) return false;
      set({ nebulaPrompt: null });
      return true;
    },

    async setNebulaRadius(index, radius) {
      await get().applyOp({ type: "SetNebulaRadius", index, radius });
    },

    async setNebulaName(index, name) {
      await get().applyOp({ type: "SetNebulaName", index, name });
    },

    async removeNebula(index) {
      const nebula = useGalaxyStore.getState().nebulae[index];
      if (!nebula) return;
      const name = nodeName(nebula.name);
      const question = `Delete ${name}? ${counted(nebula.systems.length, "system")} will leave it.`;
      if (!(await confirm(question, { title: name, kind: "warning" }))) return;
      // Removing renumbers everything after `index`, so no selection survives it.
      if (await get().applyOp({ type: "RemoveNebula", index })) set({ selectedNebula: null });
    },
  };
}
