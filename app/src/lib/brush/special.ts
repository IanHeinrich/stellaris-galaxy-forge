import type { SystemNode } from "../../generated/SystemNode";
import { isLClusterSystem } from "../guides";
import { isSpawnPoint } from "../spawn";

/**
 * Whether an eraser should leave `system` alone unless told otherwise. A system is special when
 * it has an initializer (guardians, enclaves, fallen empires, marauders, landmarks, homes), is
 * a spawn point (`isSpawnPoint`: a weight, a weighted modifier or a Paint a Galaxy seat) or
 * names a `spawn_design`, has a marauder role, anchors a fallen empire zone, carries Paint a
 * Galaxy custom connection flags, is one end of a wormhole pair, has bypasses (gateways,
 * wormholes, L-gates), or belongs to the L-Cluster.
 */
export function isSpecialSystem(system: SystemNode): boolean {
  return (
    system.initializer !== "" ||
    isSpawnPoint(system) ||
    system.spawn_design !== null ||
    system.marauder !== null ||
    system.fe_zone !== null ||
    system.fe_link.custom ||
    system.fe_link.to.length > 0 ||
    system.wormhole_pair !== null ||
    system.bypass_ids.length > 0 ||
    isLClusterSystem(system)
  );
}
