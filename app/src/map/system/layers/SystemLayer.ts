import type { Container } from "pixi.js";
import type { Camera } from "../../Camera";
import type { SystemContext } from "../context";

/** The system scene's own layers, kept apart from the galaxy's `LayerId`, which the Layers menu lists. */
export type SystemLayerId =
  "nebula" | "orbits" | "belts" | "bodies" | "labels" | "exits" | "highlight";

/** What the scene marks: the body and arrow under the pointer, the body selected, the lane clicked. */
export interface SceneHighlight {
  readonly hoverBody: number | null;
  /** The neighbour whose arrow is under the pointer. */
  readonly hoverExit: number | null;
  readonly selectedBody: number | null;
  /** The neighbour whose lane was clicked. */
  readonly lane: number | null;
}

export const NO_HIGHLIGHT: SceneHighlight = Object.freeze({
  hoverBody: null,
  hoverExit: null,
  selectedBody: null,
  lane: null,
});

/** One drawn aspect of the system scene, derived from the `SystemContext` it is rebuilt with. */
export interface SystemLayer {
  readonly id: SystemLayerId;
  readonly container: Container;
  rebuild(ctx: SystemContext): void;
  onViewport(cam: Camera): void;
  setHighlighted(ref: SceneHighlight): void;
  destroy(): void;
}
