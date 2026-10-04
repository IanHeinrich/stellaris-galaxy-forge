import { describe, expect, it } from "vitest";
import type { ContextTarget } from "../../store/mapChromeStore";
import {
  SCENE_SYSTEM as SYSTEM,
  sceneAt as at,
  sceneRecorder as recorder,
} from "../../test/mapIntent";
import { grip, over } from "./fixture";
import { SystemGestureModel, type SystemIntent } from "./SystemGestureModel";

const NEIGHBOUR = 9;

type Call = ReturnType<typeof recorder>["calls"][number];

function tap(model: SystemGestureModel, intent: SystemIntent, time: number, extra = {}): void {
  model.handle(at("down", 10, 10, { time, ...extra }), intent);
  model.handle(at("up", 10, 10, { time: time + 50, ...extra }), intent);
}

const without = (calls: Call[], name: keyof SystemIntent) => calls.filter(([n]) => n !== name);

describe("SystemGestureModel", () => {
  it("highlights the lane on a click on its arrow", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { target: over("exit", NEIGHBOUR) });
    expect(without(intent.calls, "hover")).toEqual([["selectLane", NEIGHBOUR]]);
  });

  it("enters the neighbour on a double-click on the arrow", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { target: over("exit", NEIGHBOUR) });
    tap(model, intent, 1250, { target: over("exit", NEIGHBOUR) });
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["enterSystem", NEIGHBOUR],
    ]);
  });

  it("enters nothing on two clicks on the arrow far apart in time", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { target: over("exit", NEIGHBOUR) });
    tap(model, intent, 2000, { target: over("exit", NEIGHBOUR) });
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["selectLane", NEIGHBOUR],
    ]);
  });

  it("drops the lane and goes back to the system's page on a click on empty space", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { target: over("exit", NEIGHBOUR) });
    tap(model, intent, 3000);
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["selectLane", null],
      ["showSystem"],
    ]);
  });

  it("pans on a drag from empty space or with the middle button", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    expect(model.handle(at("move", 11, 11), intent)).toBe("consumed");
    expect(model.handle(at("move", 40, 40), intent)).toBe("pan");
    model.handle(at("up", 40, 40), intent);
    model.handle(at("down", 10, 10, { button: 1 }), intent);
    expect(model.handle(at("move", 11, 10), intent)).toBe("pan");
    model.handle(at("up", 11, 10, { button: 1 }), intent);
    expect(without(intent.calls, "hover")).toEqual([]);
  });

  it("hovers what is under the pointer while idle, and nothing while it pans", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("move", 10, 10, { target: over("body", 3) }), intent);
    model.handle(at("move", 20, 10, { target: over("exit", NEIGHBOUR) }), intent);
    model.handle(at("down", 30, 30), intent);
    model.handle(at("move", 60, 60, { target: over("body", 3) }), intent);
    expect(intent.calls).toEqual([
      ["hover", over("body", 3), 10, 10],
      ["hover", over("exit", NEIGHBOUR), 20, 10],
      ["hover", null, 60, 60],
    ]);
  });

  it("opens the body menu on a right-click on a body, the belt menu on a belt's handle, and the space menu elsewhere", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 2, target: over("body", 3) }), intent);
    model.handle(at("down", 50, 60, { button: 2, wx: 12.5, wy: -4 }), intent);
    const belt = { kind: "belt" as const, index: 1 };
    model.handle(at("down", 70, 80, { button: 2, target: grip(belt) }), intent);
    const inner = { kind: "innerRadius" as const };
    model.handle(at("down", 90, 80, { button: 2, target: grip(inner), wx: 0, wy: -200 }), intent);
    const body: ContextTarget = { kind: "body", system: SYSTEM, id: 3 };
    const space: ContextTarget = { kind: "systemSpace", system: SYSTEM, x: 12.5, y: -4 };
    const onBelt: ContextTarget = { kind: "belt", system: SYSTEM, index: 1 };
    const onInner: ContextTarget = { kind: "systemSpace", system: SYSTEM, x: 0, y: -200 };
    expect(intent.calls).toEqual([
      ["contextMenu", body, 10, 10],
      ["contextMenu", space, 50, 60],
      ["contextMenu", onBelt, 70, 80],
      ["contextMenu", onInner, 90, 80],
    ]);
  });

  it("opens a body's page on a left click, each click alike", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { target: over("body", 3) });
    tap(model, intent, 1100, { target: over("body", 3) });
    tap(model, intent, 3000, { target: over("body", 4) });
    expect(without(intent.calls, "hover")).toEqual([
      ["openBody", SYSTEM, 3],
      ["openBody", SYSTEM, 3],
      ["openBody", SYSTEM, 4],
    ]);
  });

  it("opens nothing on a drag that starts on a body that cannot move, or a middle click on one", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { target: over("body", 3) }), intent);
    expect(model.handle(at("move", 40, 40, { target: over("body", 3) }), intent)).toBe("pan");
    model.handle(at("up", 40, 40, { target: over("body", 3) }), intent);
    tap(model, intent, 2000, { target: over("body", 3), button: 1 });
    expect(without(intent.calls, "hover")).toEqual([]);
  });

  it("ends a press or a pan on any button's release, clicking only on the left", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { target: over("body", 3) }), intent);
    model.handle(at("up", 10, 10, { button: 2 }), intent);
    expect(model.busy()).toBe(false);
    model.handle(at("down", 10, 10), intent);
    model.handle(at("move", 40, 40), intent);
    model.handle(at("up", 40, 40, { button: 2 }), intent);
    expect(model.busy()).toBe(false);
    expect(without(intent.calls, "hover")).toEqual([]);
  });
});
