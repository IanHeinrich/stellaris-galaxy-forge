import { describe, expect, it } from "vitest";
import { BrushModel } from "./BrushModel";
import { GestureModel } from "./GestureModel";
import type { MapInput, MapIntent, MapModel } from "./MapIntent";
import { zoneOf } from "../picking/zones";

type Call = [keyof MapIntent, ...unknown[]];

function recorder(): MapIntent & { calls: Call[] } {
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

function at(
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
    ...extra,
  };
}

function click(model: MapModel, intent: MapIntent, extra: Partial<MapInput>): void {
  model.handle(at("down", 10, 10, extra), intent);
  model.handle(at("move", 11, 12, extra), intent);
  model.handle(at("up", 11, 12, extra), intent);
}

const LANE = { a: 1, b: 2 };
const LANE_EDGE = { kind: "lane", lane: LANE } as const;
const LINK = { kind: "feLink", anchor: 9, system: 4 } as const;
const RING = { index: 3, part: "ring" } as const;
const CENTRE = { index: 3, part: "centre" } as const;
const HANDLE_X = { index: 3, part: "handle", axis: "x" } as const;
const HANDLE_Y = { index: 3, part: "handle", axis: "y" } as const;
const ZONE = { anchor: 9, zone: "ring" } as const;
const ZONE_PORT = { anchor: 9, zone: "port" } as const;
const ONE = { kind: "systems", ids: [7] } as const;
const FROM_ZONE = { kind: "feZone", anchor: 9 } as const;
const AT_ZONE = { kind: "feZone", anchor: 9, valid: true } as const;

describe("GestureModel", () => {
  it("clicks select a system, a lane, or clear both", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { system: 7 });
    click(model, intent, { system: 8, zone: "port" });
    click(model, intent, { edge: LANE_EDGE });
    click(model, intent, {});
    expect(intent.calls).toEqual([
      ["select", 7],
      ["select", 8],
      ["selectLane", LANE],
      ["clearSelection"],
    ]);
  });

  it("a press that travels less than the threshold is a click, not a move", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7 }), intent);
    model.handle(at("move", 12, 12), intent);
    expect(model.busy()).toBe(false);
    model.handle(at("up", 12, 12), intent);
    expect(intent.calls).toEqual([["select", 7]]);
  });

  it("a drag from the star moves it, previewing each point and committing the last", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7 }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("consumed");
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("move", 40, 45), intent);
    model.handle(at("up", 40, 45), intent);
    expect(model.cursor()).toBe("");
    expect(intent.calls).toEqual([
      ["previewMove", 7, 30, 30],
      ["previewMove", 7, 40, 45],
      ["commitMove", 7, 40, 45],
    ]);
  });

  it("a left drag on empty space neither pans nor moves anything", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    expect(model.handle(at("move", 12, 12), intent)).toBe("consumed");
    expect(model.handle(at("move", 30, 30), intent)).toBe("consumed");
    expect(model.cursor()).toBe("");
    expect(model.handle(at("move", 50, 50, { system: 3 }), intent)).toBe("consumed");
    model.handle(at("up", 50, 50, { system: 3 }), intent);
    expect(intent.calls).toEqual([]);
  });

  it("a middle-button drag on empty space pans", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 1 }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("pan");
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("up", 30, 30, { button: 1 }), intent);
    expect(model.busy()).toBe(false);
    expect(intent.calls).toEqual([]);
  });

  it("a middle-button drag pans even when it starts on a system, and a middle click does nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 1, system: 3, zone: "star" }), intent);
    expect(model.handle(at("move", 11, 11, { system: 3 }), intent)).toBe("pan");
    expect(model.handle(at("move", 40, 40), intent)).toBe("pan");
    model.handle(at("up", 40, 40, { button: 1 }), intent);
    model.handle(at("down", 10, 10, { button: 1, system: 3, zone: "star" }), intent);
    model.handle(at("up", 10, 10, { button: 1, system: 3, zone: "star" }), intent);
    expect(model.busy()).toBe(false);
    expect(intent.calls).toEqual([]);
  });

  it("a drag from the port grows a lane that snaps to the target and connects on release", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.cursor()).toBe("crosshair");
    const snap = { kind: "system", id: 9, valid: true } as const;
    model.handle(at("move", 60, 60, { snap }), intent);
    model.handle(at("up", 60, 60, { snap }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", ONE, 30, 30, null],
      ["previewLane", ONE, 60, 60, snap],
      ["connect", ONE, snap],
      ["endLane"],
    ]);
  });

  it("shift-drag from the star also grows a lane", () => {
    const model = new GestureModel();
    const intent = recorder();
    const snap = { kind: "system", id: 9, valid: true } as const;
    model.handle(at("down", 10, 10, { system: 7, shift: true }), intent);
    model.handle(at("move", 60, 60, { snap, shift: true }), intent);
    model.handle(at("up", 60, 60, { snap, shift: true }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", ONE, 60, 60, snap],
      ["connect", ONE, snap],
      ["endLane"],
    ]);
  });

  it("a lane drag released on empty space or on an already-linked target connects nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("up", 30, 30), intent);
    const linked = { kind: "system", id: 9, valid: false } as const;
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 60, 60, { snap: linked }), intent);
    model.handle(at("up", 60, 60, { snap: linked }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", ONE, 30, 30, null],
      ["endLane"],
      ["previewLane", ONE, 60, 60, linked],
      ["endLane"],
    ]);
  });

  it("the release uses the last previewed target, not the release event's pick", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 60, 60, { snap: { kind: "system", id: 9, valid: true } }), intent);
    model.handle(at("up", 60, 60, { system: 9 }), intent);
    expect(intent.calls.map((c) => c[0])).toEqual(["previewLane", "connect", "endLane"]);
  });

  it("shift-click or a click on the midpoint button cuts a lane", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { edge: LANE_EDGE, shift: true });
    click(model, intent, { edge: LANE_EDGE, midpointHit: true });
    expect(intent.calls).toEqual([
      ["cut", LANE_EDGE],
      ["cut", LANE_EDGE],
    ]);
  });

  it("right-click opens the context menu for a system, a lane or empty space", () => {
    const model = new GestureModel();
    const intent = recorder();
    for (const extra of [{ system: 7 }, { edge: LANE_EDGE }, {}]) {
      model.handle(at("down", 10, 20, { ...extra, button: 2 }), intent);
      model.handle(at("up", 10, 20, { ...extra, button: 2 }), intent);
    }
    expect(intent.calls).toEqual([
      ["contextMenu", { kind: "system", id: 7 }, 10, 20],
      ["contextMenu", { kind: "lane", lane: LANE }, 10, 20],
      ["contextMenu", { kind: "space", x: 10, y: 20 }, 10, 20],
    ]);
  });

  it("idle cursor follows the pick: move on a star, crosshair on the port, pointer on the ×", () => {
    const model = new GestureModel();
    const intent = recorder();
    const cursorAt = (extra: Partial<MapInput>) => {
      model.handle(at("move", 5, 5, extra), intent);
      return model.cursor();
    };
    expect(cursorAt({ system: 7 })).toBe("move");
    expect(cursorAt({ system: 7, shift: true })).toBe("crosshair");
    expect(cursorAt({ system: 7, zone: "port" })).toBe("crosshair");
    expect(cursorAt({ edge: LANE_EDGE, midpointHit: true })).toBe("pointer");
    expect(cursorAt({ edge: LANE_EDGE })).toBe("");
    expect(cursorAt({ edge: LINK, midpointHit: true })).toBe("pointer");
    expect(cursorAt({ edge: LINK })).toBe("");
    expect(cursorAt({ feZone: ZONE_PORT, zone: "port" })).toBe("crosshair");
    expect(cursorAt({ feZone: ZONE, shift: true })).toBe("crosshair");
    expect(cursorAt({})).toBe("");
  });

  it("reset mid-drag cancels the move or the rubber line and swallows the release", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7 }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.busy()).toBe(true);
    model.reset(intent);
    expect(model.busy()).toBe(false);
    model.handle(at("up", 30, 30), intent);
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 30, 30, { snap: { kind: "system", id: 9, valid: true } }), intent);
    model.handle(at("cancel", 30, 30), intent);
    model.handle(at("up", 30, 30, { snap: { kind: "system", id: 9, valid: true } }), intent);
    expect(intent.calls).toEqual([
      ["previewMove", 7, 30, 30],
      ["cancelMove"],
      ["previewLane", ONE, 30, 30, { kind: "system", id: 9, valid: true }],
      ["endLane"],
    ]);
  });

  it("shift-click or ctrl-click toggles a system in the selection instead of replacing it", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { system: 7, shift: true });
    click(model, intent, { system: 8, ctrl: true, selection: [7] });
    click(model, intent, { ctrl: true, selection: [7, 8] });
    click(model, intent, { shift: true, selection: [7, 8] });
    expect(intent.calls).toEqual([
      ["toggleSelect", 7],
      ["toggleSelect", 8],
    ]);
  });

  it("shift-drag on empty space draws a marquee and selects what it encloses on release", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 50, 50, { shift: true }), intent);
    expect(model.handle(at("move", 30, 70, { shift: true }), intent)).toBe("consumed");
    expect(model.cursor()).toBe("crosshair");
    expect(model.busy()).toBe(true);
    model.handle(at("up", 20, 80, { shift: true }), intent);
    model.handle(at("down", 10, 10, { shift: true }), intent);
    model.handle(at("move", 40, 40, { shift: true }), intent);
    model.handle(at("up", 40, 40, { shift: true, ctrl: true }), intent);
    expect(intent.calls).toEqual([
      ["previewMarquee", 50, 50, 30, 70],
      ["selectInRect", 20, 50, 50, 80, "replace"],
      ["endMarquee"],
      ["previewMarquee", 10, 10, 40, 40],
      ["selectInRect", 10, 10, 40, 40, "add"],
      ["endMarquee"],
    ]);
  });

  it("shift-drag from a lane draws no marquee and does nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { edge: LANE_EDGE, shift: true }), intent);
    expect(model.handle(at("move", 30, 30, { shift: true }), intent)).toBe("consumed");
    model.handle(at("up", 30, 30, { shift: true }), intent);
    expect(intent.calls).toEqual([]);
  });

  it("a drag on a star inside a multi-selection moves the whole group by the pointer offset", () => {
    const model = new GestureModel();
    const intent = recorder();
    const selection = [7, 8, 9];
    model.handle(at("down", 10, 10, { system: 8, selection }), intent);
    model.handle(at("move", 30, 35, { selection }), intent);
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("up", 40, 45, { selection }), intent);
    expect(intent.calls).toEqual([
      ["previewMoveGroup", selection, 20, 25],
      ["commitMoveGroup", selection, 30, 35],
    ]);
  });

  it("a drag on an unselected star moves only that star and leaves the selection alone", () => {
    const model = new GestureModel();
    const intent = recorder();
    const selection = [7, 8];
    model.handle(at("down", 10, 10, { system: 9, selection }), intent);
    model.handle(at("move", 30, 30, { selection }), intent);
    model.handle(at("up", 30, 30, { selection }), intent);
    expect(intent.calls).toEqual([
      ["previewMove", 9, 30, 30],
      ["commitMove", 9, 30, 30],
    ]);
  });

  it("a port drag from a selected star in a multi-selection connects every selected system", () => {
    const model = new GestureModel();
    const intent = recorder();
    const selection = [7, 8];
    const snap = { kind: "system", id: 9, valid: true } as const;
    model.handle(at("down", 10, 10, { system: 7, zone: "port", selection }), intent);
    model.handle(at("move", 60, 60, { snap, selection }), intent);
    expect(model.cursor()).toBe("crosshair");
    model.handle(at("up", 60, 60, { snap, selection }), intent);
    const linked = { kind: "system", id: 9, valid: false } as const;
    model.handle(at("down", 10, 10, { system: 7, shift: true, selection }), intent);
    model.handle(at("move", 60, 60, { snap: linked, shift: true, selection }), intent);
    model.handle(at("up", 60, 60, { snap: linked, shift: true, selection }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", { kind: "systems", ids: selection }, 60, 60, snap],
      ["connect", { kind: "systems", ids: selection }, snap],
      ["endLane"],
      ["previewLane", { kind: "systems", ids: selection }, 60, 60, linked],
      ["endLane"],
    ]);
  });

  it("reset mid-marquee or mid-group-move drops the preview and swallows the release", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { shift: true }), intent);
    model.handle(at("move", 30, 30, { shift: true }), intent);
    model.reset(intent);
    expect(model.busy()).toBe(false);
    model.handle(at("up", 30, 30, { shift: true }), intent);
    const selection = [7, 8];
    model.handle(at("down", 10, 10, { system: 7, selection }), intent);
    model.handle(at("move", 30, 30, { selection }), intent);
    model.handle(at("cancel", 30, 30, { selection }), intent);
    model.handle(at("up", 30, 30, { selection }), intent);
    expect(intent.calls).toEqual([
      ["previewMarquee", 10, 10, 30, 30],
      ["endMarquee"],
      ["previewMoveGroup", selection, 20, 20],
      ["cancelMove"],
    ]);
  });
});

describe("GestureModel on a nebula", () => {
  it("a click on the ring or the centre selects it, and one inside it selects nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { nebula: RING });
    click(model, intent, { nebula: CENTRE });
    click(model, intent, {});
    expect(intent.calls).toEqual([["selectNebula", 3], ["selectNebula", 3], ["clearSelection"]]);
  });

  it("a system or a lane under the pointer wins over the nebula", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { system: 7, nebula: RING });
    click(model, intent, { edge: LANE_EDGE, nebula: RING });
    expect(intent.calls).toEqual([
      ["select", 7],
      ["selectLane", LANE],
    ]);
  });

  it("a drag on the ring moves it, previewing each point and committing the last", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: RING }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.busy()).toBe(true);
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("move", 40, 45), intent);
    model.handle(at("up", 40, 45), intent);
    expect(intent.calls).toEqual([
      ["previewNebula", 3, 30, 30],
      ["previewNebula", 3, 40, 45],
      ["commitNebula", 3, 40, 45],
    ]);
  });

  it("a drag on a handle previews the radius at each point and commits the last", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: HANDLE_X }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("move", 60, 20), intent);
    model.handle(at("up", 60, 20), intent);
    expect(intent.calls).toEqual([
      ["previewNebulaRadius", 3, 30, 30],
      ["previewNebulaRadius", 3, 60, 20],
      ["commitNebulaRadius", 3, 60, 20],
    ]);
  });

  it("a drag from the centre does nothing, though a click there still selects", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: CENTRE }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("consumed");
    expect(model.cursor()).toBe("");
    model.handle(at("up", 60, 20), intent);
    expect(intent.calls).toEqual([]);
    click(model, intent, { nebula: CENTRE });
    expect(intent.calls).toEqual([["selectNebula", 3]]);
  });

  it("idle cursor says move on the ring, a resize arrow along the handle's axis, pointer on the centre", () => {
    const model = new GestureModel();
    const intent = recorder();
    const cursorAt = (extra: Partial<MapInput>) => {
      model.handle(at("move", 5, 5, extra), intent);
      return model.cursor();
    };
    expect(cursorAt({ nebula: RING })).toBe("move");
    expect(cursorAt({ nebula: HANDLE_X })).toBe("ew-resize");
    expect(cursorAt({ nebula: HANDLE_Y })).toBe("ns-resize");
    expect(cursorAt({ nebula: CENTRE })).toBe("pointer");
  });

  it("reset mid-drag drops the ghost ring and commits nothing", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: RING }), intent);
    model.handle(at("move", 30, 30), intent);
    model.reset(intent);
    expect(model.busy()).toBe(false);
    model.handle(at("up", 30, 30), intent);
    model.handle(at("down", 10, 10, { nebula: HANDLE_Y }), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("cancel", 30, 30), intent);
    model.handle(at("up", 30, 30), intent);
    expect(intent.calls).toEqual([
      ["previewNebula", 3, 30, 30],
      ["endNebula"],
      ["previewNebulaRadius", 3, 30, 30],
      ["endNebula"],
    ]);
  });

  it("right-click on a nebula targets it, and on empty space keeps the space target", () => {
    const model = new GestureModel();
    const intent = recorder();
    for (const extra of [{ nebula: RING }, {}]) {
      model.handle(at("down", 10, 20, { ...extra, button: 2 }), intent);
      model.handle(at("up", 10, 20, { ...extra, button: 2 }), intent);
    }
    expect(intent.calls).toEqual([
      ["contextMenu", { kind: "nebula", index: 3 }, 10, 20],
      ["contextMenu", { kind: "space", x: 10, y: 20 }, 10, 20],
    ]);
  });

  it("a click on a zone's ring selects its anchor, and a drag moves the ring and commits the last point", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { feZone: ZONE });
    model.handle(at("down", 10, 10, { feZone: ZONE }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("move", 40, 45), intent);
    model.handle(at("up", 40, 45), intent);
    expect(intent.calls).toEqual([
      ["selectFeZone", 9],
      ["previewFeZone", 9, 30, 30],
      ["previewFeZone", 9, 40, 45],
      ["commitFeZone", 9, 40, 45],
    ]);
  });

  it("Escape drops a ring drag without committing it", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { feZone: ZONE }), intent);
    model.handle(at("move", 30, 30), intent);
    model.reset(intent);
    model.handle(at("up", 30, 30), intent);
    expect(intent.calls).toEqual([["previewFeZone", 9, 30, 30], ["endFeZone"]]);
  });

  it("right-click on a ring targets the zone by its anchor, and the ring's cursor says it moves", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("move", 10, 20, { feZone: ZONE }), intent);
    expect(model.cursor()).toBe("move");
    model.handle(at("down", 10, 20, { feZone: ZONE, button: 2 }), intent);
    model.handle(at("up", 10, 20, { feZone: ZONE, button: 2 }), intent);
    expect(intent.calls).toEqual([["contextMenu", { kind: "feZone", anchor: 9 }, 10, 20]]);
  });

  it("shift-click or a click on the midpoint button unlinks a system from a zone", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { edge: LINK, midpointHit: true });
    click(model, intent, { edge: LINK, shift: true });
    expect(intent.calls).toEqual([
      ["cut", LINK],
      ["cut", LINK],
    ]);
  });

  it("a click on a link selects its zone's anchor, and a right-click opens the zone's menu", () => {
    const model = new GestureModel();
    const intent = recorder();
    click(model, intent, { edge: LINK });
    model.handle(at("down", 10, 20, { edge: LINK, button: 2 }), intent);
    model.handle(at("up", 10, 20, { edge: LINK, button: 2 }), intent);
    expect(intent.calls).toEqual([
      ["selectFeZone", 9],
      ["contextMenu", { kind: "feZone", anchor: 9 }, 10, 20],
    ]);
  });

  it("a port drag dropped on a zone's ring links the system, unless the ring refuses it", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 60, 60, { snap: AT_ZONE }), intent);
    model.handle(at("up", 60, 60, { snap: AT_ZONE }), intent);
    const refused = { ...AT_ZONE, valid: false };
    model.handle(at("down", 10, 10, { system: 7, zone: "port" }), intent);
    model.handle(at("move", 60, 60, { snap: refused }), intent);
    model.handle(at("up", 60, 60, { snap: refused }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", ONE, 60, 60, AT_ZONE],
      ["connect", ONE, AT_ZONE],
      ["endLane"],
      ["previewLane", ONE, 60, 60, refused],
      ["endLane"],
    ]);
  });

  it("a drag from a zone's port grows a link that snaps to a system and links it on release", () => {
    const model = new GestureModel();
    const intent = recorder();
    const snap = { kind: "system", id: 4, valid: true } as const;
    model.handle(at("down", 10, 10, { feZone: ZONE_PORT, zone: "port" }), intent);
    model.handle(at("move", 30, 30), intent);
    expect(model.cursor()).toBe("crosshair");
    model.handle(at("move", 60, 60, { snap }), intent);
    model.handle(at("up", 60, 60, { snap }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", FROM_ZONE, 30, 30, null],
      ["previewLane", FROM_ZONE, 60, 60, snap],
      ["connect", FROM_ZONE, snap],
      ["endLane"],
    ]);
  });

  it("shift-drag from the ring band also grows a link, while a plain drag there moves the ring", () => {
    const model = new GestureModel();
    const intent = recorder();
    const snap = { kind: "system", id: 4, valid: true } as const;
    model.handle(at("down", 10, 10, { feZone: ZONE, shift: true }), intent);
    model.handle(at("move", 60, 60, { snap, shift: true }), intent);
    model.handle(at("up", 60, 60, { snap, shift: true }), intent);
    model.handle(at("down", 10, 10, { feZone: ZONE }), intent);
    model.handle(at("move", 60, 60, { snap }), intent);
    model.handle(at("up", 60, 60, { snap }), intent);
    expect(intent.calls).toEqual([
      ["previewLane", FROM_ZONE, 60, 60, snap],
      ["connect", FROM_ZONE, snap],
      ["endLane"],
      ["previewFeZone", 9, 60, 60],
      ["commitFeZone", 9, 60, 60],
    ]);
  });

  it("shift-drag over a nebula still draws a marquee", () => {
    const model = new GestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { nebula: RING, shift: true }), intent);
    model.handle(at("move", 40, 40, { shift: true }), intent);
    model.handle(at("up", 40, 40, { shift: true }), intent);
    expect(intent.calls).toEqual([
      ["previewMarquee", 10, 10, 40, 40],
      ["selectInRect", 10, 10, 40, 40, "replace"],
      ["endMarquee"],
    ]);
  });
});

describe("zoneOf", () => {
  it("is the star inside the pick radius and the port on the band, only when ports show", () => {
    expect(zoneOf(0, 1, true)).toBe("star");
    expect(zoneOf(12, 1, true)).toBe("star");
    expect(zoneOf(12.5, 1, true)).toBe("port");
    expect(zoneOf(16, 1, true)).toBe("port");
    expect(zoneOf(16.5, 1, true)).toBeNull();
    expect(zoneOf(12.5, 1, false)).toBeNull();
    expect(zoneOf(12, 1, false)).toBe("star");
  });

  it("grows with the marker scale so the hit band matches the drawn ring", () => {
    expect(zoneOf(19, 2, true)).toBe("star");
    expect(zoneOf(21, 2, true)).toBe("port");
    expect(zoneOf(32, 2, true)).toBe("port");
    expect(zoneOf(33, 2, true)).toBeNull();
  });
});

describe("BrushModel", () => {
  it("lays one stroke from press to release and commits it once", () => {
    const model = new BrushModel("paint");
    const intent = recorder();
    model.handle(at("move", 5, 5), intent);
    model.handle(at("down", 10, 10), intent);
    expect(model.busy()).toBe(true);
    expect(model.handle(at("move", 30, 30), intent)).toBe("consumed");
    model.handle(at("move", 40, 45), intent);
    model.handle(at("up", 40, 45), intent);
    expect(model.busy()).toBe(false);
    expect(model.cursor()).toBe("crosshair");
    expect(intent.calls).toEqual([
      ["hoverBrush", "paint", 5, 5],
      ["beginStroke", "paint", 10, 10],
      ["extendStroke", 30, 30],
      ["extendStroke", 40, 45],
      ["commitStroke"],
      ["hoverBrush", "paint", 40, 45],
    ]);
  });

  it("a cancelled stroke, or one Esc drops, commits nothing", () => {
    const model = new BrushModel("erase");
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    model.handle(at("move", 30, 30), intent);
    model.handle(at("cancel", 30, 30), intent);
    model.handle(at("down", 10, 10), intent);
    model.reset(intent);
    model.handle(at("up", 10, 10), intent);
    expect(intent.calls).toEqual([
      ["beginStroke", "erase", 10, 10],
      ["extendStroke", 30, 30],
      ["cancelStroke"],
      ["endBrush"],
      ["beginStroke", "erase", 10, 10],
      ["cancelStroke"],
      ["endBrush"],
    ]);
  });

  it("Alt held at the press inverts the stroke, and the circle shows it", () => {
    const intent = recorder();
    new BrushModel("paint").handle(at("down", 10, 10, { alt: true }), intent);
    new BrushModel("erase").handle(at("down", 10, 10, { alt: true }), intent);
    new BrushModel("erase").handle(at("move", 12, 12, { alt: true }), intent);
    expect(intent.calls).toEqual([
      ["beginStroke", "erase", 10, 10],
      ["beginStroke", "paint", 10, 10],
      ["hoverBrush", "paint", 12, 12],
    ]);
  });

  it("the middle button pans and never strokes", () => {
    const model = new BrushModel("paint");
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 1 }), intent);
    expect(model.handle(at("move", 30, 30), intent)).toBe("pan");
    expect(model.cursor()).toBe("grabbing");
    model.handle(at("up", 30, 30, { button: 1 }), intent);
    expect(model.busy()).toBe(false);
    expect(intent.calls).toEqual([["endBrush"], ["hoverBrush", "paint", 30, 30]]);
  });
});
