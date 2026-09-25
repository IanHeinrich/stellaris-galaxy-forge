import type { MapInput, MapIntent } from "../map/interaction/MapIntent";

type Call = [keyof MapIntent, ...unknown[]];

/** A `MapIntent` that records every call, for driving a control model without a canvas. */
export function recorder(): MapIntent & { calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (name: keyof MapIntent) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    select: rec("select"),
    toggleSelect: rec("toggleSelect"),
    selectLane: rec("selectLane"),
    clearSelection: rec("clearSelection"),
    previewMarquee: rec("previewMarquee"),
    endMarquee: rec("endMarquee"),
    selectInRect: rec("selectInRect"),
    previewMove: rec("previewMove"),
    commitMove: rec("commitMove"),
    previewMoveGroup: rec("previewMoveGroup"),
    commitMoveGroup: rec("commitMoveGroup"),
    cancelMove: rec("cancelMove"),
    previewLane: rec("previewLane"),
    endLane: rec("endLane"),
    connect: rec("connect"),
    cut: rec("cut"),
    selectNebula: rec("selectNebula"),
    previewNebula: rec("previewNebula"),
    commitNebula: rec("commitNebula"),
    previewNebulaRadius: rec("previewNebulaRadius"),
    commitNebulaRadius: rec("commitNebulaRadius"),
    endNebula: rec("endNebula"),
    selectFeZone: rec("selectFeZone"),
    previewFeZone: rec("previewFeZone"),
    commitFeZone: rec("commitFeZone"),
    endFeZone: rec("endFeZone"),
    contextMenu: rec("contextMenu"),
    hoverBrush: rec("hoverBrush"),
    beginStroke: rec("beginStroke"),
    extendStroke: rec("extendStroke"),
    commitStroke: rec("commitStroke"),
    cancelStroke: rec("cancelStroke"),
    endBrush: rec("endBrush"),
  };
}

/** One input at screen (sx, sy), which is also its world point; a system or ring under it sets its zone. */
export function at(
  kind: MapInput["kind"],
  sx: number,
  sy: number,
  extra: Partial<MapInput> = {},
): MapInput {
  return {
    kind,
    sx,
    sy,
    wx: sx,
    wy: sy,
    button: kind === "move" ? -1 : 0,
    shift: false,
    ctrl: false,
    alt: false,
    selection: [],
    system: null,
    zone:
      extra.system !== undefined && extra.system !== null ? "star" : extra.feZone ? "ring" : null,
    edge: null,
    midpointHit: false,
    snap: null,
    feZone: null,
    nebula: null,
    prevented: null,
    ...extra,
  };
}
