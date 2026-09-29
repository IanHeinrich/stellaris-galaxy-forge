import type { Container } from "pixi.js";
import type { Camera } from "../../Camera";
import type { SystemContext } from "../context";

/** Where a lone cut planet would land: its point, its orbit's radius about the centre, its disc. */
export interface PasteGhost {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly disc: number;
}

/**
 * What the scene marks: the body, wormhole and arrow under the pointer, the body or wormhole selected, the lane
 * clicked, the body a panel's link names while the pointer is on the link, and the planets being
 * moved.
 */
export interface SceneHighlight {
  readonly hoverBody: number | null;
  /** The neighbour whose arrow is under the pointer. */
  readonly hoverExit: number | null;
  readonly hoverWormhole: number | null;
  readonly selectedBody: number | null;
  /** The wormhole whose page is on top of the inspector's stack. */
  readonly selectedWormhole: number | null;
  /** The neighbour whose lane was clicked. */
  readonly lane: number | null;
  readonly linkedBody: number | null;
  /** The bodies selected to move, where they are in the system shown. */
  readonly selectedBodies: readonly number[];
  /** The bodies cut from the system shown, waiting for a paste. */
  readonly cutBodies: readonly number[];
  /** Where a lone cut planet would land, while the menu that pastes it here is open. */
  readonly pasteGhost: PasteGhost | null;
}

export const NO_HIGHLIGHT: SceneHighlight = Object.freeze({
  hoverBody: null,
  hoverExit: null,
  hoverWormhole: null,
  selectedBody: null,
  selectedWormhole: null,
  lane: null,
  linkedBody: null,
  selectedBodies: [],
  cutBodies: [],
  pasteGhost: null,
});

/** One drawn aspect of the system scene, derived from the `SystemContext` it is rebuilt with. */
export interface SystemLayer {
  readonly container: Container;
  rebuild(ctx: SystemContext): void;
  onViewport?(cam: Camera): void;
  setHighlighted?(ref: SceneHighlight): void;
  destroy(): void;
}
