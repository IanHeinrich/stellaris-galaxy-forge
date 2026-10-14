import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import { useEditorStore } from "../../store/editorStore";
import { openFixtureSave, openFixtureScenario } from "../../store/editorFixture";
import { useToolStore } from "../../store/toolStore";
import { systemNode } from "../../test/builders";
import { installControllerHooks, key, mapOver } from "./controllerHarness";

installControllerHooks();

const tools = () => useToolStore.getState();
const ALT = { altKey: true };

/** Three plain systems on the Shape tool: 1 at the centre, 2 just east of it, 3 far off. */
function shapeMap() {
  tools().setTool("shape");
  const map = mapOver([
    systemNode({ id: 1, x: 0, y: 0 }),
    systemNode({ id: 2, x: 20, y: 0 }),
    systemNode({ id: 3, x: 300, y: 0 }),
  ]);
  const eraseStroke = vi.fn(async () => true);
  useEditorStore.setState({ eraseStroke });
  const centre = map.cam.worldToScreen(0, 0);
  const rim = map.cam.worldToScreen(50, 0);
  return { ...map, eraseStroke, centre, rim };
}

describe("Alt-drag with the Shape tool", () => {
  beforeEach(async () => {
    await openFixtureScenario();
  });

  it("erases the systems inside the shape drawn, in one stroke", () => {
    const { surface, eraseStroke, centre, rim } = shapeMap();
    surface.fire("pointerdown", centre.x, centre.y, ALT);
    surface.fire("pointermove", rim.x, rim.y, { buttons: 1 });
    surface.fire("pointerup", rim.x, rim.y);
    expect(eraseStroke).toHaveBeenCalledTimes(1);
    expect(eraseStroke).toHaveBeenCalledWith([1, 2]);
  });

  it("erases nothing when Esc cancels it", () => {
    const { surface, eraseStroke, centre, rim } = shapeMap();
    surface.fire("pointerdown", centre.x, centre.y, ALT);
    surface.fire("pointermove", rim.x, rim.y, { buttons: 1 });
    key("keydown", "Escape")();
    surface.fire("pointerup", rim.x, rim.y);
    expect(eraseStroke).not.toHaveBeenCalled();
  });

  it("leaves a pending arrange as it was", () => {
    const { surface, eraseStroke, cam } = shapeMap();
    expect(tools().startArrange([2, 3], { x: 150, y: 150 })).toBe(true);
    const arranging = tools().pendingShape;
    const from = cam.worldToScreen(-5, 0);
    const to = cam.worldToScreen(5, 0);
    surface.fire("pointerdown", from.x, from.y, ALT);
    surface.fire("pointermove", to.x, to.y, { buttons: 1 });
    surface.fire("pointerup", to.x, to.y);
    expect(eraseStroke).toHaveBeenCalledWith([1]);
    expect(tools().pendingShape).toBe(arranging);
  });
});

describe("Alt-drag with the Shape tool in a save", () => {
  beforeEach(async () => {
    await openFixtureSave();
  });

  it("never erases, and draws a shape instead", () => {
    const { surface, eraseStroke, centre, rim } = shapeMap();
    const before = tools().pendingShape;
    surface.fire("pointerdown", centre.x, centre.y, ALT);
    surface.fire("pointermove", rim.x, rim.y, { buttons: 1 });
    surface.fire("pointerup", rim.x, rim.y);
    expect(eraseStroke).not.toHaveBeenCalled();
    expect(tools().pendingShape).not.toBe(before);
    expect(tools().pendingShape!.purpose).toEqual({ kind: "add" });
  });
});
