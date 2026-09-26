import { Camera } from "../Camera";
import type { SystemLayer } from "./layers/SystemLayer";

export { drawOps, strokes, stubTextMeasurement } from "../layers/fixture";

/** Drives one viewport pass at `scale`, centred on `at`, as the scene's tick would. */
export function viewport(layer: SystemLayer, scale: number, at = { x: 0, y: 0 }): Camera {
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.scale = scale;
  cam.x = at.x;
  cam.y = at.y;
  cam.rev++;
  layer.onViewport(cam);
  return cam;
}
