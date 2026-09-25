import type { Container } from "pixi.js";
import type { Camera } from "./Camera";

/** What the map host shows: a root it places with the camera, and the input it takes while shown. */
export interface Scene {
  readonly cam: Camera;
  readonly root: Container;
  /** Runs every frame the scene is shown, after the host has moved its camera. */
  tick(dtMs: number): void;
  /** Takes the pointer and keys; the host has sized the camera to the canvas already. */
  activate(): void;
  /** Lets go of the pointer and keys while another scene is shown. */
  deactivate(): void;
  fit(): void;
  dispose(): void;
}
