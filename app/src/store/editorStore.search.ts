import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { SearchResult } from "../generated/SearchResult";
import type { EditorState } from "./editorStore";

type SearchActions = Pick<EditorState, "runSearch" | "clearSearch">;

export function searchActions(
  set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
): SearchActions {
  let latest = 0;
  const unring = () => {
    if (get().searchRings.length > 0) set({ searchRings: [] });
  };
  return {
    async runSearch(text, limit) {
      const seq = ++latest;
      let result: SearchResult;
      try {
        result = await ipc.search(text, limit);
      } catch (e) {
        if (seq !== latest) return null;
        unring();
        throw e;
      }
      if (seq !== latest) return null;
      set({ searchRings: result.systems });
      return result;
    },

    clearSearch() {
      latest++;
      unring();
    },
  };
}
