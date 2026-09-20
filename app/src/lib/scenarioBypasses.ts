import type { BypassLink } from "../generated/BypassLink";
import type { ScenarioBypass } from "../generated/ScenarioBypass";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { Source } from "./visual/layerGroups";

/** Which group's toggle an endpoint answers to: its initializer's, or the scripts'. */
export function bypassSource(bypass: ScenarioBypass): Source {
  return bypass.source.type === "initializer" ? "initializers" : "scripts";
}

/** Where the reader found an endpoint, as its chip says on hover. */
export function bypassSourceTitle(bypass: ScenarioBypass): string {
  return bypass.source.type === "initializer"
    ? `Placed by the initializer ${bypass.source.key}`
    : `Placed on day one by ${bypass.source.event}`;
}

/**
 * A scenario's endpoints as the links the map draws: a wormhole pair once, lower id first, and
 * only where both ends pass their own toggle; a wormhole whose partner is filtered out, like one
 * with no partner at all, draws as the marker on its own system; everything else where it stands.
 */
export function bypassLinks(
  bypasses: ScenarioBypasses | null,
  initializers: boolean,
  dayOne: boolean,
): BypassLink[] {
  const links: BypassLink[] = [];
  const paired = new Set<string>();
  const all = bypasses?.bypasses ?? [];
  const shown = new Set<ScenarioBypass>(
    all.filter((bypass) => (bypassSource(bypass) === "initializers" ? initializers : dayOne)),
  );
  const farEndShown = (system: number, partner: number): boolean =>
    all.some(
      (other) =>
        other.system === partner &&
        other.kind.type === "wormhole" &&
        other.partner === system &&
        shown.has(other),
    );
  for (const bypass of all) {
    if (!shown.has(bypass)) continue;
    const { kind, system, partner } = bypass;
    if (kind.type === "gateway") {
      links.push({ type: "gateway", system, active: !kind.ruined });
    } else if (kind.type === "other") {
      links.push({ type: "other", system, kind: kind.kind });
    } else if (partner === null || !farEndShown(system, partner)) {
      links.push({ type: "other", system, kind: "wormhole" });
    } else {
      const a = Math.min(system, partner);
      const b = Math.max(system, partner);
      if (paired.has(`${a}-${b}`)) continue;
      paired.add(`${a}-${b}`);
      links.push({ type: "wormhole", a, b });
    }
  }
  return links;
}

/** The endpoints one system carries, in the order the readers found them. */
export function bypassesOf(
  bypasses: ScenarioBypasses | null,
  system: number,
): readonly ScenarioBypass[] {
  return bypasses?.bypasses.filter((bypass) => bypass.system === system) ?? [];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What the galaxy panel says about the bypasses the game places wherever it likes; null for none. */
export function randomBypassLine(bypasses: ScenarioBypasses | null): string | null {
  if (bypasses === null) return null;
  const parts: string[] = [];
  if (bypasses.random_wormhole_pairs > 0) {
    parts.push(plural(bypasses.random_wormhole_pairs, "wormhole pair"));
  }
  if (bypasses.random_gateways > 0) parts.push(plural(bypasses.random_gateways, "gateway"));
  const random = parts.length === 0 ? null : `${parts.join(" and ")} placed at random on day one`;
  const open =
    bypasses.open_endpoints > 0
      ? `${plural(bypasses.open_endpoints, "wormhole mouth")} whose far end the game picks`
      : null;
  return [random, open].filter((s) => s !== null).join("; ") || null;
}
