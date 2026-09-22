import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { PaintModView } from "../generated/PaintModView";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { scenarioHeaderName } from "../lib/paint";
import { fileName, isUnder, joinPath } from "../lib/paths";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, readPref, writePref } from "./prefs";

/** How often to look again while the mod is missing or disabled: a Steam download is a minute. */
export const PAINT_MOD_POLL_MS = 5000;

export interface PaintModState {
  /** The mod on this machine; null when it is not installed, and until the first answer. */
  paintMod: PaintModView | null;
  /** False until the shell has answered once, so null cannot be mistaken for "not installed". */
  known: boolean;
  /** The user said the mod is not for them, so the notice for a plain scenario stays down. */
  noticeDismissed: boolean;
  /** The user's standing choice, kept per machine: new files are written for the Paint a Galaxy mod. */
  paintChoice: boolean;
  /** Opening a scenario that isn't for the mod asks first; kept per machine. */
  warnNotForPaint: boolean;

  /**
   * Asks the shell again; a failed ask leaves the last answer standing, and an answer that says
   * what the last one said leaves the same object in place.
   */
  refresh(): Promise<void>;
  /**
   * Asks now and keeps asking until told to stop, so a subscription made while the app is open
   * shows up by itself. Returns the way to stop.
   */
  watch(): () => void;
  dismissNotice(): void;
  setPaintChoice(on: boolean): void;
  setWarnNotForPaint(on: boolean): void;
  /** Save As into the mod's scenarios folder; nothing when that folder is unknown. */
  saveIntoPaintMod(): Promise<void>;
}

/** Whether two answers say the same of the mod. */
function samePaintMod(a: PaintModView | null, b: PaintModView | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.scenarios_dir === b.scenarios_dir &&
    a.enabled === b.enabled &&
    a.reserved_spawns === b.reserved_spawns
  );
}

export const usePaintModStore = create<PaintModState>((set, get) => ({
  paintMod: null,
  known: false,
  noticeDismissed: readPref(PREF_KEYS.paintNoticeDismissed, false, isBoolean),
  paintChoice: readPref(PREF_KEYS.paintProfile, true, isBoolean),
  warnNotForPaint: readPref(PREF_KEYS.warnNotForPaint, true, isBoolean),

  async refresh() {
    let fresh: PaintModView | null;
    try {
      fresh = await ipc.paintMod();
    } catch {
      // The launcher's files can be mid-write; the last answer is better than none.
      return;
    }
    const { paintMod, known } = get();
    if (known && samePaintMod(paintMod, fresh)) return;
    set({ paintMod: fresh, known: true });
  },

  watch() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      await get().refresh();
      if (stopped) return;
      timer = setTimeout(() => void tick(), PAINT_MOD_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  },

  dismissNotice() {
    writePref(PREF_KEYS.paintNoticeDismissed, true);
    set({ noticeDismissed: true });
  },

  setPaintChoice(on) {
    set({ paintChoice: on });
    writePref(PREF_KEYS.paintProfile, on);
  },

  setWarnNotForPaint(on) {
    set({ warnNotForPaint: on });
    writePref(PREF_KEYS.warnNotForPaint, on);
  },

  async saveIntoPaintMod() {
    const dir = paintScenariosDir();
    const { kind, path, title, saveAs } = useFileSessionStore.getState();
    if (kind !== "scenario" || dir === null) return;
    const name = fileName(path) || (title === null ? undefined : `${title}.txt`);
    await saveAs(name === undefined ? dir : joinPath(dir, name));
  },
}));

/** The profile the standing "For the Paint a Galaxy mod" choice asks for when a save becomes a scenario. */
export function standingProfile(): ScenarioProfile {
  return usePaintModStore.getState().paintChoice ? "paint_a_galaxy" : "plain";
}

/** The mod's scenarios folder on this machine; null until known. */
export function paintScenariosDir(): string | null {
  return usePaintModStore.getState().paintMod?.scenarios_dir ?? null;
}

/**
 * The "now what": once the file the session just wrote sits inside the mod's scenarios folder,
 * says how to find it in Stellaris. Silent when the header names no size yet.
 */
export function noteSavedIntoPaintMod(): void {
  const { kind, path, setNotice } = useFileSessionStore.getState();
  const dir = paintScenariosDir();
  if (kind !== "scenario" || path === null || dir === null || !isUnder(path, dir)) return;
  const name = scenarioHeaderName(useGalaxyStore.getState().header);
  if (name === null) return;
  setNotice(
    `Saved into the Paint a Galaxy mod. In Stellaris, start a new game and pick the size ${name}.`,
  );
}
