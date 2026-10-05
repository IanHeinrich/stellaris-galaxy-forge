import { create } from "zustand";
import * as ipc from "../api/ipc";
import { PREPARE_PRESETS, PREPARE_ROW_CHOICES } from "../generated/constants";
import type { PrepareChoice } from "../generated/PrepareChoice";
import type { PreparePreset } from "../generated/PreparePreset";
import type { PreparePreview } from "../generated/PreparePreview";
import type { PrepareRow } from "../generated/PrepareRow";
import type { HistoryEntry } from "../generated/HistoryEntry";
import type { RowChoice } from "../generated/RowChoice";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { PREF_KEYS } from "./prefKeys";
import { prefField } from "./prefs";

/** The Galaxy page's section key, which the inspector keeps open or closed. */
export const PREPARE_SECTION = "galaxy.prepare";

export type PrepareChoices = Record<PrepareRow, PrepareChoice>;
export type PresetName = PreparePreset | "custom";

/** Every row, in the panel's order. */
export const PREPARE_ROWS = Object.keys(PREPARE_ROW_CHOICES) as PrepareRow[];
export const PREPARE_PRESET_NAMES = Object.keys(PREPARE_PRESETS) as PreparePreset[];

function isPreset(value: unknown): value is PreparePreset {
  return typeof value === "string" && value in PREPARE_PRESETS;
}

const LAST_PRESET = prefField<PreparePreset>(PREF_KEYS.preparePreset, "faithful", isPreset);

/** The last Apply on the open document: what it was called, how many systems it changed, and its history line. */
export interface Applied {
  preset: PresetName;
  changed: number;
  seq: number;
}

export interface PrepareState {
  choices: PrepareChoices;
  /** The row the pointer is on; the map rings its systems. */
  hovered: PrepareRow | null;
  /** What the choices last read would do to the scenario; null until read, or while it cannot be. */
  preview: PreparePreview | null;
  /** The preview was read for these choices and the document as it stands, so Apply may trust it. */
  current: boolean;
  /** Why the last preview failed; null when it landed. */
  error: string | null;
  applied: Applied | null;
  applying: boolean;
  /** Every row takes `preset`'s choice, and the preset is remembered on this machine. */
  setPreset(preset: PreparePreset): void;
  setChoice(row: PrepareRow, choice: PrepareChoice): void;
  hover(row: PrepareRow | null): void;
  /**
   * Follows an edit, undo or redo: the preview no longer counts the document, and an Apply whose
   * history line `undo` no longer holds is forgotten.
   */
  followHistory(undo: readonly HistoryEntry[]): void;
  /** Reads the preview again, for an open scenario with game data loaded; else drops it. */
  refresh(): Promise<void>;
  /** Writes the choices as one edit and closes the section; false when nothing was written. */
  apply(): Promise<boolean>;
  /** Shows the Galaxy page with the section open, the map selection cleared. */
  reveal(): Promise<void>;
  /** Back to the remembered preset with nothing read, for another document. */
  reset(): void;
}

export function presetChoices(preset: PreparePreset): PrepareChoices {
  return { ...PREPARE_PRESETS[preset] };
}

/** The preset `choices` match, or custom. */
export function presetOf(choices: PrepareChoices): PresetName {
  return PREPARE_PRESET_NAMES.find((preset) => differing(choices, preset) === 0) ?? "custom";
}

/** The preset fewest rows differ from, and how many do; the first such preset on a tie. */
export function nearestPreset(choices: PrepareChoices): { preset: PreparePreset; rows: number } {
  let best = { preset: PREPARE_PRESET_NAMES[0], rows: Infinity };
  for (const preset of PREPARE_PRESET_NAMES) {
    const rows = differing(choices, preset);
    if (rows < best.rows) best = { preset, rows };
  }
  return best;
}

function differing(choices: PrepareChoices, preset: PreparePreset): number {
  return PREPARE_ROWS.filter((row) => choices[row] !== PREPARE_PRESETS[preset][row]).length;
}

/** Whether `row`'s choice leaves something of the scenario out: it has systems, and is not kept. */
export function leavesOut(
  state: Pick<PrepareState, "choices" | "preview">,
  row: PrepareRow,
): boolean {
  return state.choices[row] !== "keep" && rowSystems(state.preview, row).length > 0;
}

/** The rows whose choice leaves something of the scenario out of the new game. */
export function leftOutRows(state: Pick<PrepareState, "choices" | "preview">): PrepareRow[] {
  return PREPARE_ROWS.filter((row) => leavesOut(state, row));
}

/** The Galaxy page is in view: the inspector's tab, in an open dock, on the galaxy itself. */
export function galaxyShown(): boolean {
  const { tab, collapsed } = useLayoutStore.getState();
  const { stack } = useInspectorStore.getState();
  return tab === "inspector" && !collapsed && stack.length === 1 && stack[0].ref.kind === "galaxy";
}

/** The systems standing in `row`, as the last preview read them. */
export function rowSystems(preview: PreparePreview | null, row: PrepareRow): readonly number[] {
  return preview?.rows.find((r) => r.row === row)?.systems ?? [];
}

/** The systems the map rings: the hovered row's. */
export function ringedSystems(state: Pick<PrepareState, "hovered" | "preview">): readonly number[] {
  return state.hovered === null ? [] : rowSystems(state.preview, state.hovered);
}

function rowChoices(choices: PrepareChoices): RowChoice[] {
  return PREPARE_ROWS.map((row) => ({ row, choice: choices[row] }));
}

/** A preview can be read: a scenario is open and the game data that sorts its systems is loaded. */
function previewable(): boolean {
  const session = useFileSessionStore.getState();
  return (
    session.status === "ready" &&
    session.kind === "scenario" &&
    useGameDataStore.getState().status === "ready"
  );
}

/** Bumped by every read and reset, so only the latest read lands. */
let asks = 0;

function initial() {
  return {
    choices: presetChoices(LAST_PRESET.read()),
    hovered: null,
    preview: null,
    current: false,
    error: null,
    applied: null as Applied | null,
    applying: false,
  };
}

export const usePrepareStore = create<PrepareState>((set, get) => ({
  ...initial(),

  setPreset(preset) {
    LAST_PRESET.save(preset);
    set({ choices: presetChoices(preset), current: false });
    void get().refresh();
  },

  setChoice(row, choice) {
    if (get().choices[row] === choice) return;
    set({ choices: { ...get().choices, [row]: choice }, current: false });
    void get().refresh();
  },

  hover(row) {
    if (get().hovered !== row) set({ hovered: row });
  },

  followHistory(undo) {
    asks += 1;
    const { applied, current } = get();
    const gone = applied !== null && !undo.some((entry) => entry.seq === applied.seq);
    if (current || gone) set({ current: false, ...(gone ? { applied: null } : {}) });
  },

  async refresh() {
    const ask = ++asks;
    if (!previewable()) {
      set({ preview: null, current: false, error: null });
      return;
    }
    try {
      const preview = await ipc.preparePreview(rowChoices(get().choices));
      if (ask === asks) set({ preview, current: true, error: null });
    } catch (e) {
      if (ask === asks) set({ preview: null, current: false, error: ipc.errorMessage(e) });
    }
  },

  async apply() {
    const { choices, preview, current, applying } = get();
    if (applying || !current || preview === null || preview.changes === 0) return false;
    set({ applying: true });
    try {
      const done = await useEditorStore.getState().prepareForNewGame(rowChoices(choices));
      if (done === null) return false;
      set({
        applied: { preset: presetOf(choices), changed: done.changes, seq: done.seq },
        hovered: null,
      });
      useInspectorStore.getState().closeSection(PREPARE_SECTION);
      return true;
    } finally {
      set({ applying: false });
    }
  },

  async reveal() {
    if (useEditorStore.getState().selection.length > 0)
      await useEditorStore.getState().select(null);
    const { selectedLane, selectedNebula, selectLane } = useEditorStore.getState();
    if (selectedLane !== null || selectedNebula !== null) selectLane(null);
    useInspectorStore.getState().showGalaxy(PREPARE_SECTION);
  },

  reset() {
    asks += 1;
    set(initial());
  },
}));
