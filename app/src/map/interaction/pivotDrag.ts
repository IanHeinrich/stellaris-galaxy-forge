import type { Pt } from "../../lib/geometry/pt";
import { useEditorStore } from "../../store/editorStore";

/**
 * A multi-selection's pivot dragged: the store's pivot follows the pointer, as view state rather
 * than an edit, and a cancelled drag puts back the one it started from.
 */
export class PivotDrag {
  /** The pivot the drag started from, once it has moved; null turns about the centroid. */
  private from: { pivot: Pt | null } | null = null;

  move(x: number, y: number): void {
    const editor = useEditorStore.getState();
    this.from ??= { pivot: editor.rotatePivot };
    editor.setRotatePivot({ x, y });
  }

  commit(x: number, y: number): void {
    useEditorStore.getState().setRotatePivot({ x, y });
    this.from = null;
  }

  cancel(): void {
    if (this.from) useEditorStore.getState().setRotatePivot(this.from.pivot);
    this.from = null;
  }
}
