import { create } from "zustand";

export interface LGateState {
  /** Whether the Galaxy panel shows the L-Gate outcome; every document opens with it hidden. */
  revealed: boolean;
  reveal(): void;
  hide(): void;
}

export const useLGateStore = create<LGateState>((set) => ({
  revealed: false,

  reveal() {
    set({ revealed: true });
  },

  hide() {
    set({ revealed: false });
  },
}));
