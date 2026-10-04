import type { BypassLink } from "../generated/BypassLink";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { SystemNode } from "../generated/SystemNode";
import { documentCapabilities, type CapabilitySource } from "../lib/capabilities";
import { sharedWormholePair, wormholePartner } from "../lib/paint";
import { bypassLinks } from "../lib/scenarioBypasses";
import { wormholePairAction, wormholePartnerOf, type WormholePairAction } from "../lib/wormholes";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

/** What the bypass selectors read of the stores. */
export interface BypassSources {
  session: CapabilitySource;
  /** The bypasses the document writes. */
  links: readonly BypassLink[];
  /** What a scenario's initializers and day-one scripts place; null until read. */
  placed: ScenarioBypasses | null;
}

const NOTHING: readonly BypassLink[] = [];
let placedFrom: ScenarioBypasses | null = null;
let placedFlags = "";
let placedLinks: readonly BypassLink[] = NOTHING;

/** The links `placed` gives with each source shown or not, the same array while nothing moves. */
function placedLinksOf(
  placed: ScenarioBypasses | null,
  initializers: boolean,
  dayOne: boolean,
): readonly BypassLink[] {
  const flags = `${initializers} ${dayOne}`;
  if (placed !== placedFrom || flags !== placedFlags) {
    placedFrom = placed;
    placedFlags = flags;
    placedLinks = placed === null ? NOTHING : bypassLinks(placed, initializers, dayOne);
  }
  return placedLinks;
}

/**
 * The bypasses the open document shows: the ones it writes, or, where its systems name the
 * scripts that place them, the ones its initializers and day-one scripts place, each source
 * only while `initializers` and `dayOne` say to show it.
 */
export function shownBypasses(
  { session, links, placed }: BypassSources,
  initializers = true,
  dayOne = true,
): readonly BypassLink[] {
  return documentCapabilities(session).scripts
    ? placedLinksOf(placed, initializers, dayOne)
    : links;
}

/** The same, as a component reads it. */
export function useShownBypasses(initializers = true, dayOne = true): readonly BypassLink[] {
  const session = useFileSessionStore((s) => s);
  const links = useGalaxyStore((s) => s.bypasses);
  const placed = useGameDataStore((s) => s.scenarioBypasses);
  return shownBypasses({ session, links, placed }, initializers, dayOne);
}

/** What the wormhole pair selectors read of the stores. */
export interface PairSources {
  session: CapabilitySource;
  systems: ReadonlyMap<number, SystemNode>;
  links: readonly BypassLink[];
}

/**
 * The system at the other end of `system`'s wormhole pair, or null: a natural wormhole the
 * document writes where it edits those, else the pair a scenario's systems name.
 */
export function wormholePairOf(
  { session, systems, links }: PairSources,
  system: number,
): number | null {
  if (documentCapabilities(session).wormhole_pairs) return wormholePartnerOf(links, system);
  const node = systems.get(system);
  return node === undefined ? null : (wormholePartner(systems, node)?.id ?? null);
}

/** What a selection of systems `a` and `b` can do about a wormhole pair between them. */
export function pairActionOf(
  { session, systems, links }: PairSources,
  a: number,
  b: number,
): WormholePairAction {
  if (documentCapabilities(session).wormhole_pairs) return wormholePairAction(links, a, b);
  if (a === b) return null;
  return sharedWormholePair(systems, a, b) === null ? "link" : "unlink";
}

function usePairSources(): PairSources {
  const session = useFileSessionStore((s) => s);
  const systems = useGalaxyStore((s) => s.systems);
  const links = useGalaxyStore((s) => s.bypasses);
  return { session, systems, links };
}

/** `wormholePairOf`, as a component reads it. */
export function useWormholePair(system: number): number | null {
  return wormholePairOf(usePairSources(), system);
}

/** `pairActionOf`, as a component reads it. */
export function useWormholePairAction(a: number, b: number): WormholePairAction {
  return pairActionOf(usePairSources(), a, b);
}
