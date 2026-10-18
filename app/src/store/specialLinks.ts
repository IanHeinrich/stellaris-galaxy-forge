import { useMemo } from "react";
import type { SystemNode } from "../generated/SystemNode";
import type { Symmetry } from "../lib/geometry/symmetry";
import { groundFor } from "../lib/placement/ground";
import { specialLinks, type Link, type NewSystems } from "../lib/specialPicks";
import type { SpatialGrid } from "../lib/spatialGrid";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";

const OFF: Symmetry = { kind: "off" };
const NO_LINKS: Link[] = [];

function linksOf(
  added: NewSystems | null,
  systems: ReadonlyMap<number, SystemNode>,
  grid: SpatialGrid | null,
  density: number,
): Link[] {
  if (added === null || grid === null) return NO_LINKS;
  return specialLinks(added, groundFor(systems, grid, OFF), density);
}

/** The lanes that join `added` to the galaxy as it stands now; none for null. */
export function specialLinksNow(added: NewSystems | null): Link[] {
  const { systems, grid } = useGalaxyStore.getState();
  return linksOf(added, systems, grid, useMapChromeStore.getState().laneDensity);
}

/** `specialLinksNow`, for a component that redraws when the galaxy or the Lane density changes. */
export function useSpecialLinks(added: NewSystems | null): Link[] {
  const systems = useGalaxyStore((s) => s.systems);
  const grid = useGalaxyStore((s) => s.grid);
  const density = useMapChromeStore((s) => s.laneDensity);
  return useMemo(() => linksOf(added, systems, grid, density), [added, systems, grid, density]);
}
