import type { Capabilities } from "../generated/Capabilities";
import { isGalaxyLayer, type GalaxyLayers, type MapLayerId } from "../lib/visual/layerIds";
import { isSwitched } from "./layers/registry";

/**
 * Whether a layer draws. The bypasses layer draws both of a scenario's sources, so either toggle
 * keeps it on; without day-one layers, or for any other layer, its own flag decides. A layer no
 * menu switches always draws.
 */
export function layerShown(
  id: MapLayerId,
  layers: GalaxyLayers,
  capabilities: Capabilities,
): boolean {
  if (!isSwitched(id)) return true;
  if (id === "bypasses" && capabilities.create_systems)
    return layers.bypasses || layers.day_one_bypasses;
  return isGalaxyLayer(id) ? (layers[id] ?? true) : true;
}
