import type { DocumentKind } from "../generated/DocumentKind";
import { isGalaxyLayer, type GalaxyLayers, type LayerId } from "../lib/visual/layerIds";

/** Whether a layer draws. The bypasses layer draws both of a scenario's sources, so either
 * toggle keeps it on; on a save, or for any other layer, its own flag decides. */
export function layerShown(id: LayerId, layers: GalaxyLayers, kind: DocumentKind | null): boolean {
  if (id === "bypasses" && kind === "scenario") return layers.bypasses || layers.day_one_bypasses;
  return isGalaxyLayer(id) ? (layers[id] ?? true) : true;
}
