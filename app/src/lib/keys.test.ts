import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry/geometry";
import {
  keyAction,
  type KeyAction,
  layerKeyOf,
  nudgeOf,
  orbitNudge,
  radiusStepOf,
  shortcutLabel,
  toolAction,
  type KeyLike,
} from "./keys";
import { TOOLS } from "./tools";

function press(key: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

const KEY_ACTIONS: [string, Partial<KeyLike>, boolean, boolean, KeyAction | null][] = [
  // key, modifiers, typing, inspector can go back, action
  ["k", { ctrlKey: true }, true, false, "focusSearch"],
  ["i", {}, false, false, "issuesTab"],
  ["i", {}, true, false, null],
  ["I", { shiftKey: true }, false, false, "browseInitializers"],
  ["I", { shiftKey: true, ctrlKey: true }, false, false, null],
  ["I", { shiftKey: true }, true, false, null],
  ["f", {}, false, false, "focusSearch"],
  ["/", {}, false, false, "focusSearch"],
  ["f", { ctrlKey: true }, false, false, null],
  ["f", {}, true, false, null],
  ["F", { shiftKey: true }, false, false, "fitSelection"],
  ["F", { shiftKey: true, ctrlKey: true }, false, false, null],
  ["F", { shiftKey: true }, true, false, null],
  ["Home", {}, false, false, "fit"],
  ["v", {}, false, false, "selectTool"],
  ["v", {}, true, false, null],
  ["V", { shiftKey: true }, false, false, null],
  ["v", { ctrlKey: true }, false, false, "pastePlanets"],
  ["v", { altKey: true }, false, false, null],
  ["b", {}, false, false, "paintTool"],
  ["e", {}, false, false, "eraseTool"],
  ["b", {}, true, false, null],
  ["E", { shiftKey: true }, false, false, null],
  ["e", { ctrlKey: true }, false, false, null],
  ["b", { altKey: true }, false, false, null],
  ["c", {}, false, false, "connectTool"],
  ["x", {}, false, false, "cutTool"],
  ["c", {}, true, false, null],
  ["X", { shiftKey: true }, false, false, null],
  ["c", { ctrlKey: true }, false, false, "copyPlanets"],
  ["x", { ctrlKey: true }, false, false, "cutPlanets"],
  ["c", { ctrlKey: true }, true, false, null],
  ["x", { ctrlKey: true }, true, false, null],
  ["v", { ctrlKey: true }, true, false, null],
  ["V", { ctrlKey: true, shiftKey: true }, false, false, null],
  ["x", { altKey: true }, false, false, null],
  ["m", {}, false, false, "toggleSystemView"],
  ["M", { shiftKey: true }, false, false, "toggleSymmetry"],
  ["m", {}, true, false, null],
  ["M", { shiftKey: true }, true, false, null],
  ["m", { ctrlKey: true }, false, false, null],
  ["m", { altKey: true }, false, false, null],
  ["Tab", {}, false, false, "toggleDock"],
  ["Tab", { shiftKey: true }, false, false, null],
  ["Tab", {}, true, false, null],
  ["Backspace", {}, false, false, "deleteSelection"],
  ["Backspace", {}, false, true, "inspectorBack"],
  ["Delete", {}, false, true, "deleteSelection"],
  ["Backspace", {}, true, true, null],
  ["Backspace", {}, true, false, null],
  ["ArrowLeft", { altKey: true }, false, true, "inspectorBack"],
  ["ArrowLeft", { altKey: true }, false, false, null],
  ["ArrowLeft", { altKey: true }, true, true, null],
  ["ArrowLeft", {}, false, true, null],
  ["`", {}, false, false, "toggleScriptLayers"],
  ["~", { shiftKey: true }, false, false, "toggleScriptLayers"],
  ["`", { ctrlKey: true }, false, false, null],
  ["`", {}, true, false, null],
  ["1", {}, false, false, null],
  ["0", {}, false, false, "toggleInitializerLayers"],
  ["0", { ctrlKey: true }, false, false, null],
  ["0", {}, true, false, null],
];

describe("keys", () => {
  it.each(KEY_ACTIONS)("%s %o, typing %s, back %s: %s", (key, mods, typing, back, action) => {
    expect(keyAction(press(key, mods), typing, back)).toBe(action);
  });

  it("number keys 1-9 pick a layer, except while typing or with a modifier", () => {
    expect(layerKeyOf(press("1"), false)).toBe(0);
    expect(layerKeyOf(press("9"), false)).toBe(8);
    expect(layerKeyOf(press("0"), false)).toBeNull();
    expect(layerKeyOf(press("1", { ctrlKey: true }), false)).toBeNull();
    expect(layerKeyOf(press("1"), true)).toBeNull();
  });

  it("leaves 1-9 to the layers, and 0 to the initializer layers", () => {
    expect(layerKeyOf(press("1"), false)).toBe(0);
    expect(layerKeyOf(press("0"), false)).toBeNull();
  });

  it("Shift+Arrow nudges one unit in screen directions and Ctrl+Shift+Arrow ten", () => {
    const shift = { shiftKey: true };
    expect(nudgeOf(press("ArrowUp", shift), false)).toEqual({ dx: 0, dy: -SAVE_Y_SIGN });
    expect(nudgeOf(press("ArrowDown", shift), false)).toEqual({ dx: 0, dy: SAVE_Y_SIGN });
    expect(nudgeOf(press("ArrowLeft", shift), false)).toEqual({ dx: -SAVE_X_SIGN, dy: 0 });
    expect(nudgeOf(press("ArrowRight", { ...shift, ctrlKey: true }), false)).toEqual({
      dx: 10 * SAVE_X_SIGN,
      dy: 0,
    });
    expect(nudgeOf(press("ArrowUp"), false)).toBeNull();
    expect(nudgeOf(press("ArrowUp", { ...shift, altKey: true }), false)).toBeNull();
    expect(nudgeOf(press("ArrowUp", shift), true)).toBeNull();
  });

  it("turns a body clockwise as drawn on screen right and steps it out on screen up", () => {
    const orbit = (key: string, ctrlKey = false) => {
      const nudge = nudgeOf(press(key, { shiftKey: true, ctrlKey }), false);
      if (nudge === null) throw new Error(`${key} does not nudge`);
      return orbitNudge(nudge);
    };
    // Where a body at `angle` degrees about the centre is drawn: right and down are positive.
    const drawn = (angle: number) => {
      const a = (angle * Math.PI) / 180;
      return { x: SAVE_X_SIGN * Math.cos(a), y: SAVE_Y_SIGN * Math.sin(a) };
    };
    const top = 270;
    expect(drawn(top).y).toBeCloseTo(-1);
    const right = orbit("ArrowRight");
    const left = orbit("ArrowLeft");
    expect(Math.abs(right.turn)).toBe(1);
    expect(right.out).toBe(0);
    expect(drawn(top + right.turn).x).toBeGreaterThan(0);
    expect(drawn(top + left.turn).x).toBeLessThan(0);
    expect(orbit("ArrowUp")).toEqual({ turn: 0, out: 1 });
    expect(orbit("ArrowDown")).toEqual({ turn: 0, out: -1 });
    expect(orbit("ArrowRight", true)).toEqual({ turn: 10 * right.turn, out: 0 });
    expect(orbit("ArrowUp", true)).toEqual({ turn: 0, out: 10 });
  });

  it("[ and ] step the selected nebula's radius, by five with Shift", () => {
    expect(radiusStepOf(press("["), false)).toBe(-1);
    expect(radiusStepOf(press("]"), false)).toBe(1);
    expect(radiusStepOf(press("{", { shiftKey: true }), false)).toBe(-5);
    expect(radiusStepOf(press("}", { shiftKey: true }), false)).toBe(5);
    expect(radiusStepOf(press("]", { ctrlKey: true }), false)).toBeNull();
    expect(radiusStepOf(press("]"), true)).toBeNull();
    expect(radiusStepOf(press("f"), false)).toBeNull();
  });

  it("spells each binding as the tooltips show it, and gives every tool its own key", () => {
    expect(shortcutLabel("undo")).toBe("Ctrl+Z");
    expect(shortcutLabel("redo")).toBe("Ctrl+Y");
    expect(shortcutLabel("copyPlanets")).toBe("Ctrl+C");
    expect(shortcutLabel("pastePlanets")).toBe("Ctrl+V");
    expect(shortcutLabel("saveAs")).toBe("Ctrl+Shift+S");
    expect(shortcutLabel("fitSelection")).toBe("Shift+F");
    expect(shortcutLabel("clearSelection")).toBe("Esc");
    expect(shortcutLabel("toggleSymmetry")).toBe("Shift+M");
    expect(shortcutLabel("inspectorBack")).toBe("Alt+←");
    expect(TOOLS.map((t) => shortcutLabel(toolAction(t.id)))).toEqual([
      "V",
      "B",
      "E",
      "C",
      "X",
      "H",
    ]);
    for (const t of TOOLS) expect(keyAction(press(t.key), false)).toBe(toolAction(t.id));
  });
});
