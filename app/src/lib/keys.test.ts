import { describe, expect, it } from "vitest";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry/geometry";
import { keyAction, layerKeyOf, nudgeOf, radiusStepOf, type KeyLike } from "./keys";

function press(key: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("keys", () => {
  it("Ctrl+K focuses the search field, even while typing, and I opens the issues", () => {
    expect(keyAction(press("k", { ctrlKey: true }), true)).toBe("focusSearch");
    expect(keyAction(press("i"), false)).toBe("issuesTab");
    expect(keyAction(press("i"), true)).toBeNull();
  });

  it("Shift+I browses the initializers, leaving bare I to the issues", () => {
    expect(keyAction(press("I", { shiftKey: true }), false)).toBe("browseInitializers");
    expect(keyAction(press("I", { shiftKey: true, ctrlKey: true }), false)).toBeNull();
    expect(keyAction(press("I", { shiftKey: true }), true)).toBeNull();
  });

  it("F focuses the search field as in the game, and / still does", () => {
    expect(keyAction(press("f"), false)).toBe("focusSearch");
    expect(keyAction(press("/"), false)).toBe("focusSearch");
    expect(keyAction(press("f", { ctrlKey: true }), false)).toBeNull();
    expect(keyAction(press("f"), true)).toBeNull();
  });

  it("Shift+F fits the selection and Home stays the whole-galaxy fit", () => {
    expect(keyAction(press("F", { shiftKey: true }), false)).toBe("fitSelection");
    expect(keyAction(press("F", { shiftKey: true, ctrlKey: true }), false)).toBeNull();
    expect(keyAction(press("F", { shiftKey: true }), true)).toBeNull();
    expect(keyAction(press("Home"), false)).toBe("fit");
  });

  it("Tab collapses the dock, except while typing or with Shift", () => {
    expect(keyAction(press("Tab"), false)).toBe("toggleDock");
    expect(keyAction(press("Tab", { shiftKey: true }), false)).toBeNull();
    expect(keyAction(press("Tab"), true)).toBeNull();
  });

  it("Backspace goes back in the inspector when it can, and deletes the selection when it cannot", () => {
    expect(keyAction(press("Backspace"), false)).toBe("deleteSelection");
    expect(keyAction(press("Backspace"), false, true)).toBe("inspectorBack");
    expect(keyAction(press("Delete"), false, true)).toBe("deleteSelection");
    expect(keyAction(press("Backspace"), true, true)).toBeNull();
    expect(keyAction(press("Backspace"), true)).toBeNull();
  });

  it("number keys 1-9 pick a layer, except while typing or with a modifier", () => {
    expect(layerKeyOf(press("1"), false)).toBe(0);
    expect(layerKeyOf(press("9"), false)).toBe(8);
    expect(layerKeyOf(press("0"), false)).toBeNull();
    expect(layerKeyOf(press("1", { ctrlKey: true }), false)).toBeNull();
    expect(layerKeyOf(press("1"), true)).toBeNull();
  });

  it("a bare backtick or tilde toggles the scripts layers, and leaves 1-9 alone", () => {
    expect(keyAction(press("`"), false)).toBe("toggleScriptLayers");
    expect(keyAction(press("~", { shiftKey: true }), false)).toBe("toggleScriptLayers");
    expect(keyAction(press("`", { ctrlKey: true }), false)).toBeNull();
    expect(keyAction(press("`"), true)).toBeNull();
    expect(keyAction(press("1"), false)).toBeNull();
    expect(layerKeyOf(press("1"), false)).toBe(0);
  });

  it("a bare 0 toggles the initializer layers, the key 1-9 never reach", () => {
    expect(keyAction(press("0"), false)).toBe("toggleInitializerLayers");
    expect(keyAction(press("0", { ctrlKey: true }), false)).toBeNull();
    expect(keyAction(press("0"), true)).toBeNull();
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

  it("[ and ] step the selected nebula's radius, by five with Shift", () => {
    expect(radiusStepOf(press("["), false)).toBe(-1);
    expect(radiusStepOf(press("]"), false)).toBe(1);
    expect(radiusStepOf(press("{", { shiftKey: true }), false)).toBe(-5);
    expect(radiusStepOf(press("}", { shiftKey: true }), false)).toBe(5);
    expect(radiusStepOf(press("]", { ctrlKey: true }), false)).toBeNull();
    expect(radiusStepOf(press("]"), true)).toBeNull();
    expect(radiusStepOf(press("f"), false)).toBeNull();
  });
});
