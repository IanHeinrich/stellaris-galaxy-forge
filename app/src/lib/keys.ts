import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry/geometry";

/** Global keyboard bindings. Pan keys (WASD/arrows) are held keys and live in the map. */
export type KeyAction =
  | "fit"
  | "fitSelection"
  | "clearSelection"
  | "selectAll"
  | "deleteSelection"
  | "open"
  | "browse"
  | "focusSearch"
  | "undo"
  | "redo"
  | "save"
  | "saveAs"
  | "close"
  | "toggleDock"
  | "issuesTab"
  | "inspectorBack"
  | "browseInitializers"
  | "toggleScriptLayers"
  | "toggleInitializerLayers"
  | "selectTool"
  | "paintTool"
  | "eraseTool"
  | "connectTool"
  | "cutTool"
  | "toggleSymmetry";

/** A world offset that moves the selection one step across the screen. */
export interface Nudge {
  dx: number;
  dy: number;
}

/** One unit of screen travel per arrow, in world coordinates. */
const ARROW_UNIT: Record<string, Nudge> = {
  ArrowUp: { dx: 0, dy: -SAVE_Y_SIGN },
  ArrowDown: { dx: 0, dy: SAVE_Y_SIGN },
  ArrowLeft: { dx: -SAVE_X_SIGN, dy: 0 },
  ArrowRight: { dx: SAVE_X_SIGN, dy: 0 },
};

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The action bound to a key press, or null. `inInput` suppresses bare keys while typing, and
 * `canGoBack` gives Backspace to the inspector while it has a crumb to go back to.
 */
export function keyAction(e: KeyLike, inInput: boolean, canGoBack = false): KeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey && key === "o") return e.shiftKey ? "browse" : "open";
  if (mod && !e.altKey && key === "s") return e.shiftKey ? "saveAs" : "save";
  if (mod && !e.altKey && key === "w") return "close";
  if (mod && !e.altKey && key === "k") return "focusSearch";
  if (e.key === "Escape") return "clearSelection";
  if (inInput) return null;
  if (mod && !e.altKey && key === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && !e.altKey && key === "y") return "redo";
  if (mod && !e.altKey && key === "a") return "selectAll";
  if (mod || e.altKey) return null;
  if (e.key === "`" || e.key === "~") return "toggleScriptLayers";
  if (e.key === "0") return "toggleInitializerLayers";
  if (e.key === "Home") return "fit";
  if (key === "f") return e.shiftKey ? "fitSelection" : "focusSearch";
  if (e.key === "/") return "focusSearch";
  if (e.key === "Backspace") return canGoBack ? "inspectorBack" : "deleteSelection";
  if (e.key === "Delete") return "deleteSelection";
  if (e.key === "Tab" && !e.shiftKey) return "toggleDock";
  if (key === "i") return e.shiftKey ? "browseInitializers" : "issuesTab";
  if (key === "v" && !e.shiftKey) return "selectTool";
  if (key === "b" && !e.shiftKey) return "paintTool";
  if (key === "e" && !e.shiftKey) return "eraseTool";
  if (key === "c" && !e.shiftKey) return "connectTool";
  if (key === "x" && !e.shiftKey) return "cutTool";
  if (key === "m" && !e.shiftKey) return "toggleSymmetry";
  return null;
}

/** The layer a number key toggles, as an index into the store's number-key table, or null. */
export function layerKeyOf(e: KeyLike, inInput: boolean): number | null {
  if (inInput || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  const digit = Number(e.key);
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? digit - 1 : null;
}

/** Shift+Arrow nudges by one unit and Ctrl+Shift+Arrow by ten, in screen directions. */
export function nudgeOf(e: KeyLike, inInput: boolean): Nudge | null {
  const unit = ARROW_UNIT[e.key];
  if (!unit || inInput || !e.shiftKey || e.altKey) return null;
  const step = e.ctrlKey || e.metaKey ? 10 : 1;
  return { dx: unit.dx * step, dy: unit.dy * step };
}

/**
 * Which way `[` and `]` step, and how far a nebula's radius moves: one, or five with Shift.
 * A brush takes only the sign.
 */
export function radiusStepOf(e: KeyLike, inInput: boolean): number | null {
  if (inInput || e.ctrlKey || e.metaKey || e.altKey) return null;
  const step = e.shiftKey ? 5 : 1;
  if (e.key === "[" || e.key === "{") return -step;
  if (e.key === "]" || e.key === "}") return step;
  return null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
