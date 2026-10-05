import { describe, expect, it } from "vitest";
import { at, recorder } from "../../test/mapIntent";
import { AT_ZONE, click, FROM_ZONE, LINK, ONE, ZONE, ZONE_PORT } from "./gestureFixture";
import { GestureModel } from "./GestureModel";

describe("GestureModel on a fallen empire zone", () => {
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
});
