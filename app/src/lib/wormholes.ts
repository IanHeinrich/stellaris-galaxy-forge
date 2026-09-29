/** A save's natural wormhole pairs, as the galaxy's bypass links show them. */

import type { BypassLink } from "../generated/BypassLink";

/** What a two-system selection offers for a save's wormhole pair; null offers nothing. */
export type WormholePairAction = "link" | "unlink" | null;

/** The system at the other end of the natural wormhole in `system`; null when it holds none. */
export function wormholePartnerOf(bypasses: readonly BypassLink[], system: number): number | null {
  for (const link of bypasses) {
    if (link.type !== "wormhole") continue;
    if (link.a === system) return link.b;
    if (link.b === system) return link.a;
  }
  return null;
}

/** Whether `system` holds a natural wormhole or a shroud tunnel: a system holds one at most. */
export function holdsNaturalWormhole(bypasses: readonly BypassLink[], system: number): boolean {
  return bypasses.some((link) =>
    link.type === "wormhole"
      ? link.a === system || link.b === system
      : link.type === "other" && link.kind === "shroud_tunnel" && link.system === system,
  );
}

/**
 * Unlink when `a` and `b` are the two ends of one wormhole, link when neither holds a natural
 * wormhole or shroud tunnel, and nothing otherwise.
 */
export function wormholePairAction(
  bypasses: readonly BypassLink[],
  a: number,
  b: number,
): WormholePairAction {
  if (a === b) return null;
  if (wormholePartnerOf(bypasses, a) === b) return "unlink";
  if (holdsNaturalWormhole(bypasses, a) || holdsNaturalWormhole(bypasses, b)) return null;
  return "link";
}
