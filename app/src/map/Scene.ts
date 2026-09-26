import type { Container } from "pixi.js";
import type { Camera } from "./Camera";

/**
 * What the map host shows: a root it places with the camera, and the input it takes while shown.
 * A scene follows the stores from its construction to `dispose`.
 */
export interface Scene {
  readonly cam: Camera;
  readonly root: Container;
  /** Runs every frame the scene is shown, after the host has moved its camera. */
  tick(): void;
  /**
   * Takes the pointer and keys, and draws the stores as they stand for the camera; the host has
   * sized the camera to the canvas already.
   */
  activate(): void;
  /** Lets go of the pointer and keys while another scene is shown. */
  deactivate(): void;
  /** Frames the whole scene, as `Home` does. */
  fit(): void;
  /** Frames what is selected in it, as `Shift+F` does. */
  fitSelection(): void;
  dispose(): void;
}
