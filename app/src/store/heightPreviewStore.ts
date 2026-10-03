import { create } from "zustand";
import { NO_HEIGHT_PREVIEW, type HeightPreview } from "../lib/height";
import { useEditorStore } from "./editorStore";

export interface HeightPreviewState {
  /** The heights the map shows while the inspector's slider is held, by system id; not an edit. */
  preview: HeightPreview;
  /** Shows system `id` at the shown height `relative` until the preview is sent or dropped. */
  show(id: number, relative: number): void;
  /** Drops the preview of `id`, or every preview without one; the map shows the stored heights. */
  clear(id?: number): void;
  /**
   * Sends the previewed height of `id` as one edit and drops the preview once it settles, unless a
   * newer one has replaced it. True when an edit was applied.
   */
  commit(id: number): Promise<boolean>;
}

export const useHeightPreviewStore = create<HeightPreviewState>((set, get) => ({
  preview: NO_HEIGHT_PREVIEW,

  show(id, relative) {
    const { preview } = get();
    if (preview.get(id) === relative) return;
    set({ preview: new Map(preview).set(id, relative) });
  },

  clear(id) {
    const { preview } = get();
    if (id === undefined) {
      if (preview.size > 0) set({ preview: NO_HEIGHT_PREVIEW });
      return;
    }
    if (!preview.has(id)) return;
    const next = new Map(preview);
    next.delete(id);
    set({ preview: next.size === 0 ? NO_HEIGHT_PREVIEW : next });
  },

  async commit(id) {
    const value = get().preview.get(id);
    if (value === undefined) return false;
    try {
      return await useEditorStore.getState().setSystemHeight(id, value);
    } finally {
      if (get().preview.get(id) === value) get().clear(id);
    }
  },
}));
