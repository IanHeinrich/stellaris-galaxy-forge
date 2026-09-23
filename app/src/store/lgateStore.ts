import { create } from "zustand";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, prefField } from "./prefs";

const LGATE_REVEALED = prefField(PREF_KEYS.lgateRevealed, false, isBoolean);

export interface LGateState {
  /** Whether the Galaxy panel shows the L-Gate outcome, remembered across saves. */
  revealed: boolean;
  reveal(): void;
  hide(): void;
}

export const useLGateStore = create<LGateState>((set) => ({
  revealed: LGATE_REVEALED.read(),

  reveal() {
    set({ revealed: true });
    LGATE_REVEALED.save(true);
  },

  hide() {
    set({ revealed: false });
    LGATE_REVEALED.save(false);
  },
}));
