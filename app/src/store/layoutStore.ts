import { create } from "zustand";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isFiniteNumber, prefField } from "./prefs";

export const DOCK_TABS = ["inspector", "empires", "poi", "issues", "changes"] as const;
export type DockTab = (typeof DOCK_TABS)[number];

export const DOCK_MIN_WIDTH = 280;
export const DOCK_MAX_WIDTH = 520;
export const DOCK_DEFAULT_WIDTH = 340;

export interface LayoutState {
  tab: DockTab;
  /** Where Esc goes back to after a selection switched to the inspector. */
  previousTab: DockTab;
  width: number;
  collapsed: boolean;
  /** The event being handled came from inside the dock, so a selection it makes keeps the tab. */
  fromDock: boolean;
  /** The "Open a save" screen as a dialog over the map, while a save is open. */
  openDialog: boolean;
  /** The "New scenario" dialog. */
  scenarioDialog: boolean;
  setTab(tab: DockTab): void;
  noteEventSource(inDock: boolean): void;
  /** Switches to the inspector for a selection made on the map or from search. */
  revealInspector(): void;
  /** Esc: back to the tab the selection interrupted. */
  restoreTab(): void;
  setWidth(width: number): void;
  toggleDock(): void;
  /** Opens a collapsed dock for the app's own reasons, leaving the user's preference alone. */
  expandDock(): void;
  showOpenDialog(): void;
  hideOpenDialog(): void;
  showScenarioDialog(): void;
  hideScenarioDialog(): void;
}

const DOCK_WIDTH = prefField(PREF_KEYS.dockWidth, DOCK_DEFAULT_WIDTH, isFiniteNumber);
const DOCK_COLLAPSED = prefField(PREF_KEYS.dockCollapsed, false, isBoolean);

function clampWidth(width: number): number {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  tab: "inspector",
  previousTab: "inspector",
  width: clampWidth(DOCK_WIDTH.read()),
  collapsed: DOCK_COLLAPSED.read(),
  fromDock: false,
  openDialog: false,
  scenarioDialog: false,

  setTab(tab) {
    set({ tab, previousTab: tab });
  },

  noteEventSource(inDock) {
    if (get().fromDock !== inDock) set({ fromDock: inDock });
  },

  revealInspector() {
    const { fromDock, tab } = get();
    if (fromDock || tab === "inspector") return;
    set({ tab: "inspector", previousTab: tab });
  },

  restoreTab() {
    const { tab, previousTab } = get();
    if (tab === "inspector" && previousTab !== "inspector") set({ tab: previousTab });
  },

  setWidth(width) {
    const clamped = clampWidth(width);
    set({ width: clamped });
    DOCK_WIDTH.save(clamped);
  },

  toggleDock() {
    const collapsed = !get().collapsed;
    set({ collapsed });
    DOCK_COLLAPSED.save(collapsed);
  },

  expandDock() {
    if (get().collapsed) set({ collapsed: false });
  },

  showOpenDialog() {
    set({ openDialog: true });
  },

  hideOpenDialog() {
    if (get().openDialog) set({ openDialog: false });
  },

  showScenarioDialog() {
    set({ scenarioDialog: true });
  },

  hideScenarioDialog() {
    if (get().scenarioDialog) set({ scenarioDialog: false });
  },
}));
