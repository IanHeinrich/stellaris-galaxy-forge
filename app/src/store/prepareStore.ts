import { create } from "zustand";
import * as ipc from "../api/ipc";
import { PREPARE_PRESETS, PREPARE_ROW_CHOICES } from "../generated/constants";
import type { PrepareChoice } from "../generated/PrepareChoice";
import type { PrepareOptions } from "../generated/PrepareOptions";
import type { PreparePreset } from "../generated/PreparePreset";
import type { PreparePreview } from "../generated/PreparePreview";
import type { PreparedMap } from "../generated/PreparedMap";
import type { PrepareRow } from "../generated/PrepareRow";
import type { HistoryEntry } from "../generated/HistoryEntry";
import type { RowChoice } from "../generated/RowChoice";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import type { Outcome } from "../lib/prepareCopy";
import { useEditorStore } from "./editorStore";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, prefField } from "./prefs";

/** The Galaxy page's section key, which the inspector keeps open or closed. */
export const PREPARE_SECTION = "galaxy.prepare";

export type PrepareChoices = Record<PrepareRow, PrepareChoice>;
export type PresetName = PreparePreset | "custom";
/** What the pointer can be on: a row, or the option to keep threats away from starting positions. */
export type PrepareHover = PrepareRow | "clear_around";

/** Every row, in the panel's order. */
export const PREPARE_ROWS = Object.keys(PREPARE_ROW_CHOICES) as PrepareRow[];
export const PREPARE_PRESET_NAMES = Object.keys(PREPARE_PRESETS.plain) as PreparePreset[];

function isPreset(value: unknown): value is PreparePreset {
  return typeof value === "string" && value in PREPARE_PRESETS.plain;
}

const LAST_PRESET = prefField<PreparePreset>(PREF_KEYS.preparePreset, "faithful", isPreset);
const CLEAR_AROUND_SEATS = prefField(PREF_KEYS.prepareClearAroundSeats, true, isBoolean);

/** The last Apply on the open document: what it was called, how many systems it changed, and its history line. */
export interface Applied {
  preset: PresetName;
  changed: number;
  seq: number;
}

export interface PrepareState {
  choices: PrepareChoices;
  /** What the edit does beside the rows' choices, and the seed its draws take; no preset sets them. */
  options: PrepareOptions;
  /** The row or option the pointer is on; the map rings its systems. */
  hovered: PrepareHover | null;
  /**
   * What the choices last read would do to the scenario; null until read, or while it cannot be.
   * It holds the map as they would leave it when read while the outcome was shown, until an edit.
   */
  preview: PreparePreview | null;
  /** The preview was read for these choices and the document as it stands, so Apply may trust it. */
  current: boolean;
  /** Why the last preview failed; null when it landed. */
  error: string | null;
  applied: Applied | null;
  /** The Apply undo took back, which a redo brings back. */
  undone: Applied | null;
  applying: boolean;
  /** Row by row is open: it starts open for each document, and the player can fold it. */
  rowsOpen: boolean;
  /** Not now was pressed, so a scenario just taken from a save shows the whole Galaxy page. */
  dismissed: boolean;
  /** The map marks each system's outcome: the section is open on the Galaxy page, or the setup screen is up. */
  outcomeShown: boolean;
  /** Every row takes `preset`'s choice, and the preset is remembered on this machine. */
  setPreset(preset: PreparePreset): void;
  setChoice(row: PrepareRow, choice: PrepareChoice): void;
  /** Keeps threats away from starting positions or not, remembered on this machine. */
  setClearAroundSeats(on: boolean): void;
  /** Draws again: a new seed, and the preview read for it. */
  reroll(): void;
  hover(target: PrepareHover | null): void;
  setRowsOpen(open: boolean): void;
  /** Leaves the setup screen for the whole Galaxy page, with the section closed. */
  dismiss(): void;
  /** Shows the outcome or not; shown after a read that did not ask for the map, it reads again. */
  showOutcome(shown: boolean): void;
  /**
   * Follows an edit, undo or redo: the preview no longer counts the document, and its map goes
   * so the map shows the document until the preview is read again. Undoing past an
   * Apply, so that `undo` no longer holds its history line, sets it aside, shows the Galaxy page
   * with the section open, and brings the setup screen back to a scenario taken from a save. A
   * redo that brings the line back restores it and closes the section, as Apply did.
   */
  followHistory(undo: readonly HistoryEntry[]): void;
  /**
   * Reads the preview again, for an open scenario with game data loaded; else drops it. While
   * Apply runs it reads nothing: Apply reads it once its edit has landed.
   */
  refresh(): Promise<void>;
  /** Writes the choices as one edit and closes the section; false when nothing was written. */
  apply(): Promise<boolean>;
  /** Shows the Galaxy page with the section open, the map selection cleared. */
  reveal(): Promise<void>;
  /** Back to the remembered preset with nothing read and a new seed, for another document. */
  reset(): void;
}

/** `preset`'s choices on a map of `profile`. */
export function presetChoices(preset: PreparePreset, profile: ScenarioProfile): PrepareChoices {
  return { ...PREPARE_PRESETS[profile][preset] };
}

/** The preset `choices` match on a map of `profile`, or custom. */
export function presetOf(choices: PrepareChoices, profile: ScenarioProfile): PresetName {
  return (
    PREPARE_PRESET_NAMES.find((preset) => differing(choices, preset, profile) === 0) ?? "custom"
  );
}

/** The preset fewest rows differ from, and how many do; the first such preset on a tie. */
export function nearestPreset(
  choices: PrepareChoices,
  profile: ScenarioProfile,
): { preset: PreparePreset; rows: number } {
  let best = { preset: PREPARE_PRESET_NAMES[0], rows: Infinity };
  for (const preset of PREPARE_PRESET_NAMES) {
    const rows = differing(choices, preset, profile);
    if (rows < best.rows) best = { preset, rows };
  }
  return best;
}

function differing(
  choices: PrepareChoices,
  preset: PreparePreset,
  profile: ScenarioProfile,
): number {
  const chosen = PREPARE_PRESETS[profile][preset];
  return PREPARE_ROWS.filter((row) => choices[row] !== chosen[row]).length;
}

/** The profile the presets are read for: the preview's, else the open document's. */
export function currentProfile(
  preview: PreparePreview | null = usePrepareStore.getState().preview,
): ScenarioProfile {
  return preview?.profile ?? (getPaintLayer() ? "paint_a_galaxy" : "plain");
}

/** Whether a row takes a choice Forge draws, which Reroll draws again. */
export function draws(choices: PrepareChoices): boolean {
  return PREPARE_ROWS.some(
    (row) => choices[row] === "random_seats" || choices[row] === "random_zones",
  );
}

/**
 * What Galaxy Forge places anew under the choices the preview was read for: each new starting
 * position and each new fallen empire zone, by system. Nothing else is marked.
 */
export function systemOutcomes(state: Pick<PrepareState, "preview">): Map<number, Outcome> {
  const outcomes = new Map<number, Outcome>();
  const { preview } = state;
  if (preview === null) return outcomes;
  for (const zone of preview.new_zones) outcomes.set(zone.system, "zone");
  for (const system of preview.new_seats) outcomes.set(system, "seat");
  return outcomes;
}

/** The map as the choices would leave it, while the outcome is shown and the preview holds one. */
export function shownProjection(
  state: Pick<PrepareState, "outcomeShown" | "preview">,
): PreparedMap | null {
  return (state.outcomeShown && state.preview?.map) || null;
}

function setupFor(fromSave: boolean, state: Pick<PrepareState, "applied" | "dismissed">): boolean {
  return fromSave && state.applied === null && !state.dismissed;
}

/**
 * The setup screen is up: the open scenario was just taken from a save, nothing has been applied
 * to it, and Not now has not been pressed.
 */
export function setupScreen(): boolean {
  const session = useFileSessionStore.getState();
  const fromSave = session.status === "ready" && session.kind === "scenario" && session.fromSave;
  return setupFor(fromSave, usePrepareStore.getState());
}

/** `setupScreen`, for a component. */
export function useSetupScreen(): boolean {
  const fromSave = useFileSessionStore(
    (s) => s.status === "ready" && s.kind === "scenario" && s.fromSave,
  );
  const pending = usePrepareStore((s) => setupFor(true, s));
  return fromSave && pending;
}

/** Whether the map marks each system's outcome: the section is in view, open or as the setup screen. */
export function outcomeInView(): boolean {
  const session = useFileSessionStore.getState();
  if (session.status !== "ready" || session.kind !== "scenario" || !galaxyShown()) return false;
  return setupScreen() || !useInspectorStore.getState().collapsed(PREPARE_SECTION, true);
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

/** Choices only a Paint a Galaxy map offers. */
const PAINT_ONLY: ReadonlySet<PrepareChoice> = new Set<PrepareChoice>(["une_seat", "random_zones"]);

/**
 * The choices `row` offers on a map of `profile`: a UNE seat and new random zones only on a
 * Paint a Galaxy map.
 */
export function offeredChoices(
  row: PrepareRow,
  profile: ScenarioProfile,
): readonly PrepareChoice[] {
  return PREPARE_ROW_CHOICES[row].filter(
    (choice) => profile === "paint_a_galaxy" || !PAINT_ONLY.has(choice),
  );
}

/** The empire seats among the systems the choices would cut off. */
export function cutOffSeats(preview: PreparePreview | null): number {
  const seats = new Set(rowSystems(preview, "empire_seats"));
  return (preview?.cut_off ?? []).filter((system) => seats.has(system)).length;
}

/**
 * The systems the map rings: the hovered row's, and with Wormhole pairs the systems taking them
 * out cuts off; for the option to keep threats away, the systems it turns into normal systems.
 */
export function ringedSystems(state: Pick<PrepareState, "hovered" | "preview">): readonly number[] {
  if (state.hovered === null) return [];
  if (state.hovered === "clear_around") return state.preview?.kept_clear ?? [];
  const systems = rowSystems(state.preview, state.hovered);
  const cutOff = state.hovered === "wormhole_pairs" ? (state.preview?.cut_off ?? []) : [];
  if (cutOff.length === 0) return systems;
  return [...new Set([...systems, ...cutOff])];
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
/** Whether the latest read asked for the map as the choices would leave it. */
let mapAsked = false;

/** `preview` without its map, which stands for the document only until an edit. */
function unmapped(preview: PreparePreview): PreparePreview {
  return { ...preview, map: undefined };
}

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

function initial() {
  return {
    choices: presetChoices(LAST_PRESET.read(), currentProfile(null)),
    options: { clear_around_seats: CLEAR_AROUND_SEATS.read(), seed: newSeed() },
    hovered: null,
    preview: null,
    current: false,
    error: null,
    applied: null as Applied | null,
    undone: null as Applied | null,
    applying: false,
    rowsOpen: true,
    dismissed: false,
  };
}

export const usePrepareStore = create<PrepareState>((set, get) => ({
  ...initial(),
  outcomeShown: false,

  setPreset(preset) {
    LAST_PRESET.save(preset);
    set({ choices: presetChoices(preset, currentProfile()), current: false });
    void get().refresh();
  },

  setChoice(row, choice) {
    if (get().choices[row] === choice) return;
    set({ choices: { ...get().choices, [row]: choice }, current: false });
    void get().refresh();
  },

  setClearAroundSeats(on) {
    if (get().options.clear_around_seats === on) return;
    CLEAR_AROUND_SEATS.save(on);
    set({ options: { ...get().options, clear_around_seats: on }, current: false });
    void get().refresh();
  },

  reroll() {
    set({ options: { ...get().options, seed: newSeed() }, current: false });
    void get().refresh();
  },

  hover(target) {
    if (get().hovered !== target) set({ hovered: target });
  },

  setRowsOpen(open) {
    set({ rowsOpen: open });
  },

  dismiss() {
    set({ dismissed: true });
    useInspectorStore.getState().closeSection(PREPARE_SECTION);
  },

  showOutcome(shown) {
    if (get().outcomeShown === shown) return;
    set({ outcomeShown: shown });
    if (shown && !mapAsked && previewable()) void get().refresh();
  },

  followHistory(undo) {
    asks += 1;
    const { applied, undone, current, preview, applying } = get();
    // Apply keeps the map until the classification it changed is read again.
    if (preview?.map && !applying) set({ preview: unmapped(preview) });
    const holds = (entry: Applied) => undo.some(({ seq }) => seq === entry.seq);
    const gone = applied !== null && !holds(applied);
    const back = applied === null && undone !== null && holds(undone);
    if (current || gone || back) set({ current: false });
    if (back) {
      set({ applied: undone, undone: null });
      useInspectorStore.getState().closeSection(PREPARE_SECTION);
      return;
    }
    if (!gone) return;
    set({ applied: null, undone: applied });
    if (useFileSessionStore.getState().fromSave) set({ dismissed: false });
    void get().reveal();
  },

  async refresh() {
    const ask = ++asks;
    if (get().applying) return;
    if (!previewable()) {
      set({ preview: null, current: false, error: null });
      return;
    }
    try {
      const { choices, options, outcomeShown } = get();
      mapAsked = outcomeShown;
      const preview = await ipc.preparePreview(rowChoices(choices), options, outcomeShown);
      if (ask === asks) set({ preview, current: true, error: null });
    } catch (e) {
      if (ask === asks) set({ preview: null, current: false, error: ipc.errorMessage(e) });
    }
  },

  async apply() {
    const { choices, preview, current, applying } = get();
    if (applying || !current || preview === null || preview.changes === 0) return false;
    set({ applying: true });
    let done: { seq: number; changes: number } | null = null;
    try {
      done = await useEditorStore.getState().prepareForNewGame(rowChoices(choices), get().options);
      if (done === null) return false;
      set({
        applied: {
          preset: presetOf(choices, currentProfile()),
          changed: done.changes,
          seq: done.seq,
        },
        undone: null,
        hovered: null,
      });
      useInspectorStore.getState().closeSection(PREPARE_SECTION);
      return true;
    } finally {
      set({ applying: false });
      const held = get().preview;
      if (done !== null && held?.map) set({ preview: unmapped(held) });
      if (done !== null) void get().refresh();
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
    mapAsked = false;
    set(initial());
  },
}));
