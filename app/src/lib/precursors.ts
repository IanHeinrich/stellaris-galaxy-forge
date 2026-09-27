import type { PrecursorView } from "../generated/PrecursorView";
import type { SystemNode } from "../generated/SystemNode";

/** The `hiddenPrecursors` key that hides a system with no precursor flag. */
export const NO_PRECURSOR = "";

/** One precursor the legend lists: an install definition with how many systems carry its flag. */
export interface PrecursorRegion {
  key: string;
  name: string;
  /** Definition order, for `paletteColor` beyond the fixed list. */
  index: number;
  count: number;
}

/** Every system's precursor flags, resolved against the install's definitions. */
export interface PrecursorRegions {
  /** Precursors with at least one system, in definition order. */
  legend: readonly PrecursorRegion[];
  /** A system's precursor flag keys, in definition order; a system with none is absent. */
  bySystem: ReadonlyMap<number, readonly string[]>;
  /** Systems with no precursor flag. */
  none: number;
}

export const NO_PRECURSORS: PrecursorRegions = Object.freeze({
  legend: [],
  bySystem: new Map<number, readonly string[]>(),
  none: 0,
});

/**
 * Each system's precursor flags, matched against the install's definitions and kept in
 * definition order. A flag no definition names, such as `precursor_system`, is not a region and
 * is ignored.
 */
export function composePrecursors(
  systems: ReadonlyMap<number, SystemNode>,
  defs: readonly PrecursorView[],
): PrecursorRegions {
  if (defs.length === 0) return NO_PRECURSORS;
  const indexOf = new Map(defs.map((def, index) => [def.key, index]));
  const bySystem = new Map<number, readonly string[]>();
  const counts = new Map<string, number>();
  let none = 0;
  for (const system of systems.values()) {
    const keys = system.flags
      .filter((flag) => indexOf.has(flag))
      .sort((a, b) => indexOf.get(a)! - indexOf.get(b)!);
    if (keys.length === 0) {
      none++;
      continue;
    }
    bySystem.set(system.id, keys);
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const legend = defs
    .map((def, index) => ({ key: def.key, name: def.name, index, count: counts.get(def.key) ?? 0 }))
    .filter((region) => region.count > 0);
  return { legend, bySystem, none };
}
