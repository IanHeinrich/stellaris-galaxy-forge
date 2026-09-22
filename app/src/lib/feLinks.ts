/**
 * Paint a Galaxy's custom connections, which the core reads into `SystemNode.fe_link`; the
 * flags are described in docs/paint-a-galaxy-integration.md under "Fallen empire zones".
 */

import type { SystemNode } from "../generated/SystemNode";
import type { Pt } from "./geometry/pt";
import { FE_ZONE_RADIUS, feZoneCentre } from "./feZone";

/** What the ring's menu and the inspector offer to give a zone back to the mod's own rule. */
export const USE_NEAREST_LABEL = "Use nearest systems instead";

/** The inspector's shorter wording of the same button, under the Connections block. */
export const USE_NEAREST_SHORT_LABEL = "Use nearest instead";

/** Whether `system` anchors a zone and takes custom connections for it under an id. */
export function takesCustomLinks(system: SystemNode): boolean {
  return system.fe_link.custom && system.fe_link.id !== null && system.fe_zone !== null;
}

export interface Segment {
  a: Pt;
  b: Pt;
}

/** The line from `from` to the nearest point of a zone's ring about `centre`; null from inside the ring. */
export function toRing(from: Pt, centre: Pt): Segment | null {
  const d = Math.hypot(centre.x - from.x, centre.y - from.y);
  if (d <= FE_ZONE_RADIUS) return null;
  const t = FE_ZONE_RADIUS / d;
  return {
    a: { x: from.x, y: from.y },
    b: { x: centre.x + (from.x - centre.x) * t, y: centre.y + (from.y - centre.y) * t },
  };
}

/** The line the map draws a link along, from `system` to the ring `anchor` anchors; null without a zone. */
export function linkSegment(anchor: SystemNode, system: Pt): Segment | null {
  if (anchor.fe_zone === null) return null;
  return toRing(system, feZoneCentre(anchor, anchor.fe_zone));
}

/** Whether `system` links to the id `anchor` takes, whatever else the anchor's flags say. */
export function isLinked(anchor: SystemNode, system: SystemNode): boolean {
  const id = anchor.fe_link.id;
  return id !== null && system.id !== anchor.id && system.fe_link.to.includes(id);
}

/** The systems linked to the zone `anchor` anchors, ascending by id; none while it takes no id. */
export function linkedTo(
  anchor: SystemNode,
  systems: ReadonlyMap<number, SystemNode>,
): SystemNode[] {
  const linked: SystemNode[] = [];
  for (const s of systems.values()) {
    if (isLinked(anchor, s)) linked.push(s);
  }
  return linked.sort((a, b) => a.id - b.id);
}

/** The anchors taking each id `system` links to, in id order then by anchor; a shared id lists every taker. */
export function linkedAnchors(
  system: SystemNode,
  systems: ReadonlyMap<number, SystemNode>,
): SystemNode[] {
  const anchors: SystemNode[] = [];
  for (const id of system.fe_link.to) {
    const takers = [...systems.values()]
      .filter((s) => s.id !== system.id && takesCustomLinks(s) && s.fe_link.id === id)
      .sort((a, b) => a.id - b.id);
    anchors.push(...takers);
  }
  return anchors;
}

/** Why `system` cannot be linked to the zone `anchor` anchors, or null when it can. */
export function linkRefusal(
  anchor: SystemNode,
  system: SystemNode,
  name: (s: SystemNode) => string,
): string | null {
  if (anchor.fe_zone === null) return `${name(anchor)} anchors no fallen empire zone`;
  if (system.id === anchor.id) return `${name(anchor)} cannot link to its own zone`;
  if (isLinked(anchor, system)) {
    return `${name(system)} is already linked to ${name(anchor)}'s fallen empire zone`;
  }
  return null;
}

/** Why `system` cannot be unlinked from the zone `anchor` anchors, or null when it can. */
export function unlinkRefusal(
  anchor: SystemNode,
  system: SystemNode,
  name: (s: SystemNode) => string,
): string | null {
  if (isLinked(anchor, system)) return null;
  return `${name(system)} is not linked to ${name(anchor)}'s fallen empire zone`;
}

export type LinkChange = "link" | "unlink";

/**
 * What the menu offers between `system` and the zone `anchor` anchors: a link for a system not
 * yet linked, an unlink for one that is, nothing when the anchor anchors no zone or the system
 * is the anchor itself.
 */
export function linkChange(anchor: SystemNode, system: SystemNode): LinkChange | null {
  if (anchor.fe_zone === null || system.id === anchor.id) return null;
  return isLinked(anchor, system) ? "unlink" : "link";
}

/** The system menu's item, named after the selected anchor. */
export function linkToZoneLabel(change: LinkChange, anchor: string): string {
  return change === "link"
    ? `Link to ${anchor}'s fallen empire zone`
    : `Unlink from ${anchor}'s fallen empire zone`;
}

/** The ring menu's item, named after the selected system. */
export function linkSelectedLabel(change: LinkChange, system: string): string {
  return change === "link" ? `Link ${system} to this zone` : `Unlink ${system} from this zone`;
}
