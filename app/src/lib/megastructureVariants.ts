/**
 * Which type the game makes of a megastructure stage at a given star: a completion that swaps its
 * finished row for another type, such as Gigastructural Engineering's star-class Dyson Spheres,
 * decides it from the star's class and the save's global flags.
 */
import type { MegastructureSwap } from "../generated/MegastructureSwap";
import type { MegastructureView as MegastructureType } from "../generated/MegastructureView";

/** What a swap's conditions are tested against. */
export interface SwapContext {
  /** The class of the body the row stands at; null in empty space or when it isn't known. */
  readonly starClass: string | null;
  /** The save's global flags. */
  readonly globalFlags: ReadonlySet<string>;
}

/** Whether `swap` asks nothing: the completion makes it whatever the star and the save. */
export function swapAlways(swap: MegastructureSwap): boolean {
  return (
    swap.resolved &&
    swap.flags.length === 0 &&
    swap.no_flags.length === 0 &&
    swap.classes === null &&
    swap.not_classes.length === 0
  );
}

/** Whether `swap` tests the star's class. */
export function swapByStarClass(swap: MegastructureSwap): boolean {
  return swap.classes !== null || swap.not_classes.length > 0;
}

/** Whether the completion makes `swap` at `at`. A swap the files leave unresolved never holds. */
export function swapHolds(swap: MegastructureSwap, at: SwapContext): boolean {
  const { starClass, globalFlags } = at;
  return (
    swap.resolved &&
    swap.flags.every((flag) => globalFlags.has(flag)) &&
    !swap.no_flags.some((flag) => globalFlags.has(flag)) &&
    (swap.classes === null || (starClass !== null && swap.classes.includes(starClass))) &&
    (starClass === null || !swap.not_classes.includes(starClass))
  );
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
 * The chain a swap into `into` starts: `into`, then each type first built over the one before.
 * Empty when `types` has no `into`.
 */
export function swapChain(into: string, types: ReadonlyMap<string, MegastructureType>): string[] {
  return chainFrom(into, builtOverFirst(types), (key) => types.has(key));
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

/**
 * The type the game makes of each stage of `keys`, one chain in build order, at `at`. For each
 * stage it takes the last stage up to it with swaps and that stage's first swap that holds, and
 * walks the chain the swap starts as far as the stage is past it. With no swap holding, or a chain
 * too short, the stage is its own type.
 */
export function chainVariants(
  keys: readonly string[],
  types: ReadonlyMap<string, MegastructureType>,
  at: SwapContext,
): string[] {
  let from: { index: number; chain: string[] } | null = null;
  return keys.map((key, i) => {
    const swaps = types.get(key)?.swaps ?? [];
    if (swaps.length > 0) {
      const holds = swaps.find((swap) => swapHolds(swap, at));
      from = { index: i, chain: holds === undefined ? [] : swapChain(holds.into, types) };
    }
    return from?.chain[i - from.index] ?? key;
  });
}

/** Whether some stage of `keys` swaps its row by the star's class. */
export function swapsByStarClass(
  keys: readonly string[],
  types: ReadonlyMap<string, MegastructureType>,
): boolean {
  return keys.some((key) => types.get(key)?.swaps.some(swapByStarClass) ?? false);
}
