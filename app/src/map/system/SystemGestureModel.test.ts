import { describe, expect, it } from "vitest";
import type { ContextTarget } from "../../store/mapChromeStore";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

const SYSTEM = 5;
const NEIGHBOUR = 9;

type Call = [keyof SystemIntent, ...unknown[]];

function recorder(): SystemIntent & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    hover: (...args) => void calls.push(["hover", ...args]),
    selectLane: (...args) => void calls.push(["selectLane", ...args]),
    enterSystem: (...args) => void calls.push(["enterSystem", ...args]),
    contextMenu: (...args) => void calls.push(["contextMenu", ...args]),
  };
}

function at(
  kind: SystemInput["kind"],
  sx: number,
  sy: number,
  extra: Partial<SystemInput> = {},
): SystemInput {
  return {
    kind,
    sx,
    sy,
    wx: sx,
    wy: sy,
    button: kind === "move" ? -1 : 0,
    shift: false,
    ctrl: false,
    time: 0,
    system: SYSTEM,
    body: null,
    exit: null,
    ...extra,
  };
}

function tap(model: SystemGestureModel, intent: SystemIntent, time: number, extra = {}): void {
  model.handle(at("down", 10, 10, { time, ...extra }), intent);
  model.handle(at("up", 10, 10, { time: time + 50, ...extra }), intent);
}

const without = (calls: Call[], name: keyof SystemIntent) => calls.filter(([n]) => n !== name);

describe("SystemGestureModel", () => {
  it("highlights the lane on a click on its arrow", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    expect(without(intent.calls, "hover")).toEqual([["selectLane", NEIGHBOUR]]);
  });

  it("enters the neighbour on a double-click on the arrow", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    tap(model, intent, 1250, { exit: NEIGHBOUR });
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["enterSystem", NEIGHBOUR],
    ]);
  });

  it("enters nothing on two clicks on the arrow far apart in time", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    tap(model, intent, 2000, { exit: NEIGHBOUR });
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["selectLane", NEIGHBOUR],
    ]);
  });

  it("drops the lane on a click on empty space", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    tap(model, intent, 3000);
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["selectLane", null],
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
    model.handle(at("move", 10, 10, { body: 3 }), intent);
    model.handle(at("move", 20, 10, { exit: NEIGHBOUR }), intent);
    model.handle(at("down", 30, 30), intent);
    model.handle(at("move", 60, 60, { body: 3 }), intent);
    expect(intent.calls).toEqual([
      ["hover", 3, null, 10, 10],
      ["hover", null, NEIGHBOUR, 20, 10],
      ["hover", null, null, 60, 60],
    ]);
  });

  it("opens the body menu on a right-click on a body, and the space menu elsewhere", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 2, body: 3 }), intent);
    model.handle(at("down", 50, 60, { button: 2, wx: 12.5, wy: -4 }), intent);
    const body: ContextTarget = { kind: "body", system: SYSTEM, id: 3 };
    const space: ContextTarget = { kind: "systemSpace", system: SYSTEM, x: 12.5, y: -4 };
    expect(intent.calls).toEqual([
      ["contextMenu", body, 10, 10],
      ["contextMenu", space, 50, 60],
    ]);
  });

  it("does nothing on a left click on a body in this stage", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { body: 3 });
    tap(model, intent, 1100, { body: 3 });
    expect(without(intent.calls, "hover")).toEqual([]);
  });
});
