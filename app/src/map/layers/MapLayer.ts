import type { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { Camera } from "../Camera";
import type { AppIssue } from "../../lib/issues";
import type { LayerId } from "../../lib/visual/layerIds";
import type { MoveGhost } from "../moveGhosts";
import type { RenderContext } from "../RenderContext";

/** The systems being dragged: where each is previewed, and the same ghosts by system id. */
export interface DragState {
  readonly ghosts: readonly MoveGhost[];
  readonly byId: ReadonlyMap<number, MoveGhost>;
}

/**
 * One drawn aspect of the map. A layer derives everything it shows from the `RenderContext`
 * it is rebuilt with and from the view state the controller sets on it. The optional
 * setters say what a layer responds to, not who calls it.
 */
export interface MapLayer {
  readonly id: LayerId;
  readonly container: Container;
  /** Re-derives what the layer draws; called for every context the controller assembles. */
  rebuild(ctx: RenderContext): void;
  applyDelta(d: GalaxyDelta): void;
  onViewport(cam: Camera, ctx: RenderContext): void;
  setVisible(v: boolean): void;
  /** A drag in progress: preview every ghost, fade what it leaves behind. `null` ends it. */
  setDragState?(drag: DragState | null): void;
  /** The point-of-interest kinds switched on in the Layers menu. */
  setShownKinds?(kinds: ReadonlySet<SpecialKind>): void;
  /** The selected nebula, by file-order index, drawn with its resize handles; `null` when none. */
  setSelectedNebula?(index: number | null): void;
  /** The selected systems, for a layer that draws what one of them owns differently. */
  setSelection?(ids: readonly number[]): void;
  /** The validator's latest findings. */
  setIssues?(issues: readonly AppIssue[]): void;
  /** Systems whose label is placed before any other, whatever their rank. */
  setPinned?(ids: readonly number[]): void;
  /** The system under the pointer, for a layer that labels it whatever its rank. */
  setHovered?(id: number | null): void;
  /** Whether the details layer is drawing its own row of icons under every system. */
  setDetailsShown?(shown: boolean): void;
  /** Whether the marauder clans layer is on, for a layer that paints the clans' territories. */
  setClansShown?(shown: boolean): void;
  destroy(): void;
}

/** Screen-pixel factor for markers: grows gently with zoom between a floor and a ceiling. */
export function markerScale(camScale: number): number {
  return Math.min(2, Math.max(0.7, Math.sqrt(camScale)));
}
