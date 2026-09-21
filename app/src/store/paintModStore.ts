import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { PaintModView } from "../generated/PaintModView";
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

  /** Asks the shell again; a failed ask leaves the last answer standing. */
  refresh(): Promise<void>;
  /**
   * Asks now and keeps asking until the mod is enabled, so a subscription made while the app is
   * open shows up by itself. Returns the way to stop.
   */
  watch(): () => void;
  dismissNotice(): void;
}

export const usePaintModStore = create<PaintModState>((set, get) => ({
  paintMod: null,
  known: false,
  noticeDismissed: readPref(PREF_KEYS.paintNoticeDismissed, false, isBoolean),

  async refresh() {
    try {
      set({ paintMod: await ipc.paintMod(), known: true });
    } catch {
      // The launcher's files can be mid-write; the last answer is better than none.
    }
  },

  watch() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      await get().refresh();
      if (stopped || get().paintMod?.enabled) return;
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
}));
