import type { SystemDetail } from "../../generated/SystemDetail";
import { OPEN_RESULT, SYSTEMS } from "./galaxy";

export function detailOf(id: number): SystemDetail {
  const system = SYSTEMS.find((s) => s.id === id)!;
  return {
    system,
    neighbours: system.lanes.map((l) => {
      const to = SYSTEMS.find((s) => s.id === l.to)!;
      return {
        id: to.id,
        name_key: to.name.key,
        length: l.length,
        bridge: l.bridge,
        distance: Math.hypot(to.x - system.x, to.y - system.y),
      };
    }),
    nebula: system.nebula === null ? null : OPEN_RESULT.galaxy.nebulae[system.nebula],
  };
}
