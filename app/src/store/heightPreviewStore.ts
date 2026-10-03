import { create } from "zustand";
import { NO_HEIGHT_PREVIEW, type HeightPreview } from "../lib/height";
import { useEditorStore } from "./editorStore";

export interface HeightPreviewState {
  /** The heights the map shows in place of the stored ones, by system id: the inspector's over the brush's. */
  preview: HeightPreview;
  /** The heights the inspector's slider previews while it is held; not an edit. */
  inspector: HeightPreview;
  /** The heights the height brush previews under the pointer or for a stroke on its way. */
  brush: HeightPreview;
  /** Shows system `id` at the shown height `relative` until the inspector sends or drops it. */
  show(id: number, relative: number): void;
  /** Drops the inspector's preview of `id`, or all of it without one; the brush's stays. */
  clear(id?: number): void;
  /**
   * Sends the inspector's previewed height of `id` as one edit and drops the preview once it
   * settles, unless a newer one has replaced it. True when an edit was applied.
   */
  commit(id: number): Promise<boolean>;
  /** Replaces the brush's preview with `heights`; the same heights again change nothing. */
  showBrush(heights: HeightPreview): void;
}

function sameHeights(a: HeightPreview, b: HeightPreview): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, height] of a) if (b.get(id) !== height) return false;
  return true;
}

function merged(inspector: HeightPreview, brush: HeightPreview): HeightPreview {
  if (brush.size === 0) return inspector;
  if (inspector.size === 0) return brush;
  return new Map([...brush, ...inspector]);
}

export const useHeightPreviewStore = create<HeightPreviewState>((set, get) => {
  const inspect = (inspector: HeightPreview) =>
    set({ inspector, preview: merged(inspector, get().brush) });

  return {
    preview: NO_HEIGHT_PREVIEW,
    inspector: NO_HEIGHT_PREVIEW,
    brush: NO_HEIGHT_PREVIEW,

    show(id, relative) {
      const { inspector } = get();
      if (inspector.get(id) === relative) return;
      inspect(new Map(inspector).set(id, relative));
    },

    clear(id) {
      const { inspector } = get();
      if (id === undefined) {
        if (inspector.size > 0) inspect(NO_HEIGHT_PREVIEW);
        return;
      }
      if (!inspector.has(id)) return;
      const next = new Map(inspector);
      next.delete(id);
      inspect(next.size === 0 ? NO_HEIGHT_PREVIEW : next);
    },

    async commit(id) {
      const value = get().inspector.get(id);
      if (value === undefined) return false;
      try {
        return await useEditorStore.getState().setSystemHeight(id, value);
      } finally {
        if (get().inspector.get(id) === value) get().clear(id);
      }
    },

    showBrush(heights) {
      const { brush, inspector } = get();
      if (sameHeights(brush, heights)) return;
      const next = heights.size === 0 ? NO_HEIGHT_PREVIEW : heights;
      set({ brush: next, preview: merged(inspector, next) });
    },
  };
});
