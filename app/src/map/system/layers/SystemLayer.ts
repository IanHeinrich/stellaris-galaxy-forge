import type { Container } from "pixi.js";
import type { Camera } from "../../Camera";
import type { SystemContext } from "../context";

/**
 * What the scene marks: the body and arrow under the pointer, the body selected, the lane clicked,
 * and the body a panel's link names while the pointer is on the link.
 */
export interface SceneHighlight {
  readonly hoverBody: number | null;
  /** The neighbour whose arrow is under the pointer. */
  readonly hoverExit: number | null;
  readonly selectedBody: number | null;
  /** The neighbour whose lane was clicked. */
  readonly lane: number | null;
  readonly linkedBody: number | null;
}

export const NO_HIGHLIGHT: SceneHighlight = Object.freeze({
  hoverBody: null,
  hoverExit: null,
  selectedBody: null,
  lane: null,
  linkedBody: null,
});

/** One drawn aspect of the system scene, derived from the `SystemContext` it is rebuilt with. */
export interface SystemLayer {
  readonly container: Container;
  rebuild(ctx: SystemContext): void;
  onViewport?(cam: Camera): void;
  setHighlighted?(ref: SceneHighlight): void;
  destroy(): void;
}
