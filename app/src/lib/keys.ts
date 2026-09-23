import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry/geometry";
import { TOOLS, type Tool } from "./tools";

/** The key that picks a tool. */
export type ToolAction = `${Tool}Tool`;

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
  | "toggleSymmetry"
  | ToolAction;

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

interface Binding {
  /** `KeyboardEvent.key`, lower case for a letter. */
  key: string;
  action: KeyAction;
  /** Ctrl, or Cmd on a Mac. Alt is never part of a binding. */
  mod?: boolean;
  /** Whether Shift must be held, or must not be; either when absent. */
  shift?: boolean;
  /** Fires while a field has the caret. */
  inInput?: boolean;
  /** Fires whatever modifiers are held. */
  anyModifiers?: boolean;
  /** Fires only while the inspector has a crumb to go back to. */
  whileBack?: boolean;
}

/** Every binding, first match wins; an action's first binding is the one its label spells. */
const BINDINGS: readonly Binding[] = [
  { key: "Escape", action: "clearSelection", inInput: true, anyModifiers: true },
  { key: "o", mod: true, shift: false, action: "open", inInput: true },
  { key: "o", mod: true, shift: true, action: "browse", inInput: true },
  { key: "s", mod: true, shift: false, action: "save", inInput: true },
  { key: "s", mod: true, shift: true, action: "saveAs", inInput: true },
  { key: "w", mod: true, action: "close", inInput: true },
  { key: "f", shift: false, action: "focusSearch" },
  { key: "k", mod: true, action: "focusSearch", inInput: true },
  { key: "z", mod: true, shift: false, action: "undo" },
  { key: "y", mod: true, action: "redo" },
  { key: "z", mod: true, shift: true, action: "redo" },
  { key: "a", mod: true, action: "selectAll" },
  { key: "`", action: "toggleScriptLayers" },
  { key: "~", action: "toggleScriptLayers" },
  { key: "0", action: "toggleInitializerLayers" },
  { key: "Home", action: "fit" },
  { key: "f", shift: true, action: "fitSelection" },
  { key: "/", action: "focusSearch" },
  { key: "Backspace", action: "inspectorBack", whileBack: true },
  { key: "Delete", action: "deleteSelection" },
  { key: "Backspace", action: "deleteSelection" },
  { key: "Tab", shift: false, action: "toggleDock" },
  { key: "i", shift: false, action: "issuesTab" },
  { key: "i", shift: true, action: "browseInitializers" },
  ...TOOLS.map((t): Binding => ({ key: t.key, shift: false, action: toolAction(t.id) })),
  { key: "m", shift: false, action: "toggleSymmetry" },
];

/** The action that picks `tool`. */
export function toolAction(tool: Tool): ToolAction {
  return `${tool}Tool`;
}

export function isToolAction(action: KeyAction): action is ToolAction {
  return TOOLS.some((t) => toolAction(t.id) === action);
}

/** The tool `action` picks. */
export function toolOfAction(action: ToolAction): Tool {
  return TOOLS.find((t) => toolAction(t.id) === action)!.id;
}

const KEY_NAMES: Record<string, string> = { Escape: "Esc", Delete: "Del" };

function labelOf(b: Binding): string {
  const key = KEY_NAMES[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key);
  return [b.mod && "Ctrl", b.shift && "Shift", key].filter(Boolean).join("+");
}

/** How menus and tooltips spell the key for `action`, such as "Ctrl+Z" or "V". */
export function shortcutLabel(action: KeyAction): string {
  const binding = BINDINGS.find((b) => b.action === action);
  return binding ? labelOf(binding) : "";
}

function matches(b: Binding, e: KeyLike, key: string, inInput: boolean, canGoBack: boolean) {
  if (b.key !== key || (inInput && !b.inInput) || (b.whileBack && !canGoBack)) return false;
  if (b.anyModifiers) return true;
  const mod = e.ctrlKey || e.metaKey;
  return mod === !!b.mod && !e.altKey && (b.shift === undefined || b.shift === e.shiftKey);
}

/**
 * The action bound to a key press, or null. `inInput` suppresses bare keys while typing, and
 * `canGoBack` gives Backspace to the inspector while it has a crumb to go back to.
 */
export function keyAction(e: KeyLike, inInput: boolean, canGoBack = false): KeyAction | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return BINDINGS.find((b) => matches(b, e, key, inInput, canGoBack))?.action ?? null;
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
