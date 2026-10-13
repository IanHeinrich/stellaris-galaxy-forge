/**
 * The types a completion swaps a finished row into, such as Gigastructural Engineering's
 * star-class Dyson Spheres, which the Add megastructure dialog lists by the stage they are swapped
 * from. Which one the game makes at a star the shell says.
 */
import type { MegastructureSwap } from "../generated/MegastructureSwap";
import type { MegastructureView as MegastructureType } from "../generated/MegastructureView";

/** Whether `swap` tests the star's class. */
function swapByStarClass(swap: MegastructureSwap): boolean {
  return swap.classes !== null || swap.not_classes.length > 0;
}

/** Each type by the first type it is built over, in `types`' order; ruins and repairs left out. */
function builtOverFirst(types: ReadonlyMap<string, MegastructureType>): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const type of types.values()) {
    const [first] = type.upgrade_from;
    if (first === undefined || type.variant_of !== null) continue;
    const keys = next.get(first);
    if (keys) keys.push(type.key);
    else next.set(first, [type.key]);
  }
  return next;
}

function chainFrom(
  into: string,
  next: ReadonlyMap<string, string[]>,
  has: (key: string) => boolean,
) {
  const chain: string[] = [];
  for (let at: string | undefined = into; at !== undefined && has(at) && !chain.includes(at);) {
    chain.push(at);
    at = next.get(at)?.find((key) => !chain.includes(key));
  }
  return chain;
}

/**
 * Every type on a chain some swap leads to. The game makes them only by swapping, so the dialog
 * lists the stage they are swapped from instead. With `byStarClass`, only the chains of swaps
 * that test the star's class.
 */
export function swappedTypes(
  types: ReadonlyMap<string, MegastructureType>,
  byStarClass = false,
): Set<string> {
  const next = builtOverFirst(types);
  const swapped = new Set<string>();
  for (const type of types.values()) {
    for (const swap of type.swaps) {
      if (byStarClass && !swapByStarClass(swap)) continue;
      for (const key of chainFrom(swap.into, next, (k) => types.has(k) && k !== type.key)) {
        swapped.add(key);
      }
    }
  }
  return swapped;
}

/** Whether some stage of `keys` swaps its row by the star's class. */
export function swapsByStarClass(
  keys: readonly string[],
  types: ReadonlyMap<string, MegastructureType>,
): boolean {
  return keys.some((key) => types.get(key)?.swaps.some(swapByStarClass) ?? false);
}
