import type { Capabilities } from "../generated/Capabilities";
import { isGalaxyLayer, type GalaxyLayers, type LayerId } from "../lib/visual/layerIds";

/**
 * Whether a layer draws. The bypasses layer draws both of a scenario's sources, so either toggle
 * keeps it on; without day-one layers, or for any other layer, its own flag decides.
 */
export function layerShown(id: LayerId, layers: GalaxyLayers, capabilities: Capabilities): boolean {
  if (id === "bypasses" && capabilities.create_systems)
    return layers.bypasses || layers.day_one_bypasses;
  return isGalaxyLayer(id) ? (layers[id] ?? true) : true;
}
