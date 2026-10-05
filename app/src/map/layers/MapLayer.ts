import type { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { Camera } from "../Camera";
import type { DrawnChange } from "../drawnPositions";
import type { AppIssue } from "../../lib/issues";
import type { Outcome } from "../../lib/prepareCopy";
import type { MapLayerId } from "../../lib/visual/layerIds";
import type { WatchRings } from "../../lib/watchlist";
import type { MoveGhost } from "../moveGhosts";
import type { RenderContext } from "../RenderContext";

/** The systems being dragged: where each is previewed, and the same ghosts by system id. */
export interface DragState {
  readonly ghosts: readonly MoveGhost[];
  readonly byId: ReadonlyMap<number, MoveGhost>;
}

/** Whether two sets, or the keys of two maps, hold the same ids. */
export function sameKeys(
  a: ReadonlySet<number> | ReadonlyMap<number, unknown>,
  b: ReadonlySet<number> | ReadonlyMap<number, unknown>,
): boolean {
  if (a.size !== b.size) return false;
  for (const id of a.keys()) if (!b.has(id)) return false;
  return true;
}

/**
 * One drawn aspect of the map. A layer derives everything it shows from the `RenderContext`
 * it is rebuilt with and from the view state the controller sets on it. The optional
 * setters say what a layer responds to, not who calls it.
 */
export interface MapLayer {
  readonly id: MapLayerId;
  readonly container: Container;
  /** Drawn above every layer's container, under the highlights. */
  readonly overlay?: Container;
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
  /** The watchlist's shown entries and the systems each finds. */
  setWatchlist?(rings: readonly WatchRings[]): void;
  /** What each system becomes under the Prepare choices, while the section is in view; empty otherwise. */
  setOutcome?(outcomes: ReadonlyMap<number, Outcome>): void;
  /** Systems whose label is placed before any other, whatever their rank. */
  setPinned?(ids: readonly number[]): void;
  /** The system under the pointer, for a layer that labels it whatever its rank. */
  setHovered?(id: number | null): void;
  /** Whether the details layer is drawing its own row of icons under every system. */
  setDetailsShown?(shown: boolean): void;
  /** Whether the marauder clans layer is on, for a layer that paints the clans' territories. */
  setClansShown?(shown: boolean): void;
  /** Whether the L-Cluster guide's chip shows the L-Gate outcome, for `LClusterLayer`. */
  setLGateRevealed?(revealed: boolean): void;
  /**
   * Systems draw somewhere else, as the map leans or a height is previewed; a layer redraws only
   * what the change names.
   */
  onDrawn?(change: DrawnChange): void;
  destroy(): void;
}

/** Screen-pixel factor for markers: grows gently with zoom between a floor and a ceiling. */
export function markerScale(camScale: number): number {
  return Math.min(2, Math.max(0.7, Math.sqrt(camScale)));
}
