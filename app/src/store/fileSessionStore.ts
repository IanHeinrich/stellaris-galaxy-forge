import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { isSgfError } from "../api/errors";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import type { Capabilities } from "../generated/Capabilities";
import type { DocumentKind } from "../generated/DocumentKind";
import type { ErrorKind } from "../generated/ErrorKind";
import type { ExportReport } from "../generated/ExportReport";
import type { ExportResult } from "../generated/ExportResult";
import type { Issue } from "../generated/Issue";
import type { OpenResult } from "../generated/OpenResult";
import type { Progress } from "../generated/Progress";
import type { SaveMeta } from "../generated/SaveMeta";
import type { SaveResult } from "../generated/SaveResult";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { duplicateNameNote, type AppIssue, type NoteCode } from "../lib/issues";
import { paintLayer, scenarioHeaderName } from "../lib/paint";
import { fileName, isUnder, joinPath } from "../lib/paths";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { isNote, issueKey, useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { usePaintModStore } from "./paintModStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, readPref, writePref } from "./prefs";
import { recentSubtitle, useRecentsStore } from "./recentsStore";

export type Status = "empty" | "loading" | "ready" | "error";

/** What a picked save is opened as: edited in place, or taken as the start of a scenario. */
export type OpenMode = "save" | "scenario";

const SAVE_FILTER = { name: "Stellaris save", extensions: ["sav"] };
const SCENARIO_FILTER = { name: "Stellaris static galaxy scenario", extensions: ["txt"] };

export interface FileSessionState {
  status: Status;
  progress: Progress | null;
  /** What is opening, named for the loading overlay; null unless a document is loading or settling. */
  loadingName: string | null;
  /** True once the galaxy has loaded but a scenario's owners pass hasn't landed yet. */
  settling: boolean;
  error: string | null;
  /** The error's kind, alongside its message; null whenever `error` is. */
  errorKind: ErrorKind | null;
  /** A plain status message, such as what a save into the Paint a Galaxy mod says to do next. */
  notice: string | null;
  path: string | null;
  /** The format of the open document; null until one is open. */
  kind: DocumentKind | null;
  /** The document's own name: the empire's, or the scenario's. */
  title: string | null;
  meta: SaveMeta | null;
  /** What the open document supports; null until one is open. */
  capabilities: Capabilities | null;
  /** The validator's findings, with the notes the document opened with and the app's own after them. */
  issues: AppIssue[];
  dirty: boolean;
  saving: boolean;
  lastSave: SaveResult | null;
  /** Where the last export landed and what it could not carry over; null until one is written. */
  lastExport: ExportResult | null;
  /** When the last export landed, by the machine's own clock. */
  exportedAt: number | null;
  /** When the last save landed, by the machine's own clock. */
  savedAt: number | null;
  /** The open file sits where Steam Cloud may overwrite it with its cloud copy. */
  cloud: boolean;
  /** The cloud path the user has already agreed to write this session. */
  cloudAcknowledged: string | null;
  /** Keys of the warnings and errors the user has already agreed to save this document with. */
  dismissedIssues: string[];
  /** A save waiting for the user to say which way to open it. */
  pendingOpen: string | null;
  /** What an export would carry over, waiting for the user to confirm or cancel it. */
  pendingExport: ExportReport | null;
  /** The user's standing choice, kept per machine: new files are written for the Paint a Galaxy mod. */
  paintChoice: boolean;
  /** The open scenario carries Paint a Galaxy's scripts or flags, or Forge's header for the mod. */
  painted: boolean;
  /** The open scenario was started or opened under the mod's profile, whatever its bytes say. */
  paintChosen: boolean;

  /** Resolves true when the document opened; false when it failed, or another open was in flight. */
  openSave(path: string): Promise<boolean>;
  /** Opens the scenario file at `path`; `paint` says the file is known to be the site's. */
  openScenario(path: string, options?: { paint?: boolean }): Promise<boolean>;
  /** Opens the save at `path` as a new, unsaved scenario; the save itself is untouched. */
  openScenarioFrom(path: string, profile?: ScenarioProfile): Promise<boolean>;
  /** Starts an empty, unsaved scenario, written under `profile`; left out, a plain one. */
  newScenario(
    name: string,
    radius: number,
    coreRadius: number,
    profile?: ScenarioProfile,
  ): Promise<boolean>;
  /** Opens `path`, asking first how a save is to be opened. */
  requestOpen(path: string): Promise<void>;
  /** Answers the pending open; null cancels it. */
  chooseOpenMode(mode: OpenMode | null): Promise<void>;
  /** With a `mode`, the picker filters to `.sav` and skips straight to that mode, no dialog. */
  pickAndOpen(mode?: OpenMode): Promise<void>;
  /** Picks a scenario file and opens it as `openScenario` would; resolves true once it is open. */
  pickAndOpenScenario(options?: { paint?: boolean }): Promise<boolean>;
  /** Re-reads the open file from disk, discarding unsaved changes on confirmation. */
  reload(): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  /** Save As into the Paint a Galaxy mod's scenarios folder; nothing when that folder is unknown. */
  saveIntoPaintMod(): Promise<void>;
  /** Previews what exporting the open save carries over, and asks whether to write it. */
  exportScenario(): Promise<void>;
  /** Answers the pending export: writes the scenario under `profile`, or cancels on null. */
  confirmExport(profile: ScenarioProfile | null): Promise<void>;
  /** Resolves true when it is safe to discard the session: not dirty, or the user confirmed. */
  confirmDiscard(): Promise<boolean>;
  /** What an edit reported about the file it belongs to. */
  noteEdit(patch: { issues: Issue[]; dirty: boolean }): void;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
  setPaintChoice(on: boolean): void;
}

const INITIAL = {
  status: "empty" as Status,
  progress: null as Progress | null,
  loadingName: null as string | null,
  settling: false,
  error: null as string | null,
  errorKind: null as ErrorKind | null,
  notice: null as string | null,
  path: null as string | null,
  kind: null as DocumentKind | null,
  title: null as string | null,
  meta: null as SaveMeta | null,
  capabilities: null as Capabilities | null,
  issues: [] as AppIssue[],
  dirty: false,
  saving: false,
  lastSave: null as SaveResult | null,
  lastExport: null as ExportResult | null,
  exportedAt: null as number | null,
  savedAt: null as number | null,
  cloud: false,
  cloudAcknowledged: null as string | null,
  dismissedIssues: [] as string[],
  pendingOpen: null as string | null,
  pendingExport: null as ExportReport | null,
  painted: false,
  paintChosen: false,
} satisfies Partial<FileSessionState>;

const CLOUD_WARNING =
  "This file is in Steam's cloud folder. Steam can overwrite it with the cloud copy. " +
  "Close Steam or disable Steam Cloud for Stellaris before you play it. Save anyway?";

export const useFileSessionStore = create<FileSessionState>((set, get) => ({
  ...INITIAL,
  paintChoice: readPref(PREF_KEYS.paintProfile, true, isBoolean),

  openSave(path) {
    return openDocument(path, () => ipc.openSave(path));
  },

  async openScenario(path, options) {
    if (get().saving || !(await get().confirmDiscard())) return false;
    return openDocument(path, () => ipc.openSave(path), undefined, undefined, options?.paint);
  },

  openScenarioFrom(path, profile) {
    return openDocument(null, () => ipc.openAsScenario(path, profile), fileName(path), profile);
  },

  async newScenario(name, radius, coreRadius, profile) {
    if (get().saving || !(await get().confirmDiscard())) return false;
    return openDocument(
      null,
      () => ipc.newScenario(name, radius, coreRadius, profile),
      name,
      profile,
    );
  },

  async requestOpen(path) {
    if (get().saving || !(await get().confirmDiscard())) return;
    await routeOpen(path);
  },

  async chooseOpenMode(mode) {
    const path = get().pendingOpen;
    set({ pendingOpen: null });
    if (path === null || mode === null) return;
    await (mode === "scenario" ? get().openScenarioFrom(path) : get().openSave(path));
  },

  async pickAndOpen(mode) {
    if (get().saving || !(await get().confirmDiscard())) return;
    const [defaultPath] = await ipc.saveDirs().catch(() => []);
    const picked = await open({
      defaultPath,
      filters:
        mode === undefined
          ? [{ name: "All supported", extensions: ["sav", "txt"] }, SAVE_FILTER, SCENARIO_FILTER]
          : [SAVE_FILTER],
      multiple: false,
      directory: false,
    });
    if (typeof picked !== "string") return;
    if (mode === undefined) {
      await routeOpen(picked);
    } else {
      await (mode === "scenario" ? get().openScenarioFrom(picked) : get().openSave(picked));
    }
  },

  async pickAndOpenScenario(options) {
    if (get().saving || !(await get().confirmDiscard())) return false;
    const picked = await open({ filters: [SCENARIO_FILTER], multiple: false, directory: false });
    if (typeof picked !== "string") return false;
    return openDocument(picked, () => ipc.openSave(picked), undefined, undefined, options?.paint);
  },

  async reload() {
    const { path, saving, paintChosen } = get();
    if (path === null || saving || !(await get().confirmDiscard())) return;
    // What the user said of the file when opening it is not in its bytes, so it is said again.
    await openDocument(path, () => ipc.openSave(path), undefined, undefined, paintChosen);
  },

  async close() {
    if (get().saving || !(await get().confirmDiscard())) return;
    try {
      await ipc.closeSave();
    } finally {
      useGalaxyStore.getState().clear();
      useGameDataStore.getState().onSaveClosed();
      set({ ...INITIAL });
    }
  },

  async save() {
    const { status, saving, path, cloud } = get();
    if (status !== "ready" || saving) return;
    if (path === null) {
      await get().saveAs();
      return;
    }
    if (!(await confirmIssues())) return;
    if (cloud && !(await confirmCloudWrite(path))) return;
    if (await writeSave(() => ipc.save())) void noteDuplicateNames();
  },

  async saveAs() {
    const { status, saving, kind, path, title } = get();
    if (status !== "ready" || saving) return;
    const filter = kind === "scenario" ? SCENARIO_FILTER : SAVE_FILTER;
    await saveTo(path ?? newFilePath(title, filter.extensions[0], getPaintLayer()), filter);
  },

  async saveIntoPaintMod() {
    const { status, saving, kind, path, title } = get();
    const dir = paintScenariosDir();
    if (status !== "ready" || saving || kind !== "scenario" || dir === null) return;
    const name = fileName(path) || defaultName(title, "txt");
    await saveTo(name === undefined ? dir : joinPath(dir, name), SCENARIO_FILTER);
  },

  async exportScenario() {
    const { status, saving, kind } = get();
    if (status !== "ready" || saving || kind !== "save") return;
    const mine = opens;
    try {
      const report = await ipc.previewExport();
      // A preview that lands after another document opened belongs to nobody.
      if (mine !== opens || get().status !== "ready") return;
      set({ pendingExport: report });
    } catch (e) {
      set({ error: ipc.errorMessage(e), errorKind: isSgfError(e) ? e.kind : null });
    }
  },

  async confirmExport(profile) {
    const { pendingExport, status, saving, kind, title } = get();
    if (pendingExport === null || status !== "ready" || saving || kind !== "save") return;
    set({ pendingExport: null });
    if (profile === null) return;
    const picked = await saveDialog({
      defaultPath: newFilePath(title, "txt", profile === "paint_a_galaxy"),
      filters: [SCENARIO_FILTER],
    });
    if (picked === null) return;
    // The export is a second file: the session keeps its own path, and its edits stay unsaved.
    await runWrite(
      () => ipc.exportScenario(picked, profile),
      (result) => ({ lastExport: result, exportedAt: Date.now() }),
    );
  },

  async confirmDiscard() {
    if (!get().dirty) return true;
    return confirm("Discard unsaved changes?", {
      title: fileName(get().path) || (get().title ?? ""),
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Cancel",
    });
  },

  noteEdit({ issues, dirty }) {
    set({ issues: withNotes(issues), dirty, error: null, errorKind: null });
  },

  setError(message) {
    set({ error: message, errorKind: null });
  },

  setNotice(message) {
    set({ notice: message });
  },

  setPaintChoice(on) {
    set({ paintChoice: on });
    writePref(PREF_KEYS.paintProfile, on);
  },
}));

/** Whether the open document is written for the Paint a Galaxy mod, for a component. */
export function usePaintLayer(): boolean {
  const paintMod = usePaintModStore((s) => s.paintMod);
  return useFileSessionStore((s) => paintLayer(s, paintMod));
}

/** The same fact outside React. */
export function getPaintLayer(): boolean {
  return paintLayer(useFileSessionStore.getState(), usePaintModStore.getState().paintMod);
}

export function isSavePath(path: string): boolean {
  return path.toLowerCase().endsWith(".sav");
}

/** An edit's fresh findings, with the notes the document opened with kept after them. */
function withNotes(issues: Issue[]): AppIssue[] {
  const { notes } = useIssuesStore.getState();
  return notes.length === 0 ? issues : [...issues, ...notes];
}

const DUPLICATE_NAME: NoteCode = "scenario_name_duplicate";

/**
 * Notes every other file in the Paint a Galaxy mod's scenarios folder whose header lists the
 * open scenario's name, since the game shows one size per name. Nothing for a file elsewhere,
 * and a folder that cannot be read leaves no note.
 */
async function noteDuplicateNames(): Promise<void> {
  const { getState, setState } = useFileSessionStore;
  const mine = opens;
  const { kind, path } = getState();
  const dir = paintScenariosDir();
  const name = scenarioHeaderName(useGalaxyStore.getState().header);
  let notes: AppIssue[] = [];
  if (kind === "scenario" && path !== null && dir !== null && isUnder(path, dir) && name !== null) {
    const siblings = await ipc.siblingScenarioNames(path).catch(() => []);
    if (mine !== opens || getState().path !== path) return;
    notes = siblings
      .filter(([, other]) => other === name)
      .map(([file]) => duplicateNameNote(name, file));
  }
  const issues = getState().issues;
  if (notes.length === 0 && !issues.some((issue) => issue.code === DUPLICATE_NAME)) return;
  useIssuesStore.getState().setNotes(DUPLICATE_NAME, notes);
  setState({ issues: [...issues.filter((issue) => issue.code !== DUPLICATE_NAME), ...notes] });
}

/** What a document with no file of its own is offered as a name. */
function defaultName(title: string | null, extension: string): string | undefined {
  return title === null ? undefined : `${title}.${extension}`;
}

/** The Paint a Galaxy mod's scenarios folder on this machine; null until known. */
function paintScenariosDir(): string | null {
  return usePaintModStore.getState().paintMod?.scenarios_dir ?? null;
}

/** Where a new file is offered: inside the mod's scenarios folder when it is written for the mod. */
function newFilePath(title: string | null, extension: string, forPaintMod: boolean) {
  const name = defaultName(title, extension);
  const dir = forPaintMod ? paintScenariosDir() : null;
  return dir !== null && name !== undefined ? joinPath(dir, name) : name;
}

/** The open a late answer still belongs to; a newer open leaves the older one's to nobody. */
let opens = 0;

/**
 * The one path every open takes: `path` is the file it comes from, null for a new document, and
 * `profile` what a new one is written under, which a file with no systems yet cannot show.
 */
async function openDocument(
  path: string | null,
  load: () => Promise<OpenResult>,
  name?: string,
  profile?: ScenarioProfile,
  paint = profile === "paint_a_galaxy",
): Promise<boolean> {
  const { getState, setState } = useFileSessionStore;
  // One document opens at a time: a second ask is refused rather than queued behind it.
  if (getState().status === "loading") return false;
  const mine = ++opens;
  setState({ ...INITIAL, status: "loading", path, loadingName: name ?? (fileName(path) || null) });
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await onProgress((progress) => {
      if (getState().status === "loading") setState({ progress });
    });
    const result = await load();
    // What the document supports settles before the galaxy lands: the map reads it as it loads.
    setState({
      status: "ready",
      progress: null,
      path: result.path,
      cloud: result.cloud,
      kind: result.kind,
      title: result.title,
      meta: result.meta,
      capabilities: result.capabilities,
      issues: result.issues,
      painted: result.painted,
      paintChosen: paint,
    });
    if (result.path !== null) {
      useRecentsStore.getState().noteOpened({
        kind: result.kind,
        path: result.path,
        title: result.title,
        subtitle: recentSubtitle(result.kind, result.meta, result.galaxy.systems.length),
      });
    }
    useGalaxyStore.getState().load(result.galaxy);
    void noteDuplicateNames();
    if (result.kind === "scenario" && useGameDataStore.getState().status === "ready") {
      setState({ settling: true });
      try {
        await useGameDataStore.getState().onSaveOpened();
      } finally {
        setState({ settling: false, loadingName: null });
      }
    } else {
      void useGameDataStore.getState().onSaveOpened();
      setState({ loadingName: null });
    }
    // Only once details are warm can the classifier name an event-spawned country.
    void ipc
      .warmDetails()
      .then(() => useGameDataStore.getState().refreshSpecial())
      .catch((e: unknown) => {
        if (mine === opens && getState().status === "ready") {
          getState().setError(ipc.errorMessage(e));
        }
      });
    return true;
  } catch (e) {
    // A failed open leaves the previous session alive on the Rust side.
    await ipc.closeSave().catch(() => undefined);
    useGalaxyStore.getState().clear();
    setState({
      ...INITIAL,
      status: "error",
      error: ipc.errorMessage(e),
      errorKind: isSgfError(e) ? e.kind : null,
      path,
    });
    return false;
  } finally {
    unlisten?.();
  }
}

/** A scenario opens at once; a save first asks whether to edit it as a save or as a scenario. */
async function routeOpen(path: string): Promise<void> {
  const { getState, setState } = useFileSessionStore;
  if (!isSavePath(path)) {
    await getState().openSave(path);
    return;
  }
  setState({ pendingOpen: path });
}

/** Asks where the file goes, starting at `defaultPath`, and writes it there. */
async function saveTo(
  defaultPath: string | undefined,
  filter: { name: string; extensions: string[] },
): Promise<void> {
  if (!(await confirmIssues())) return;
  const picked = await saveDialog({ defaultPath, filters: [filter] });
  if (picked === null) return;
  const cloud = await ipc.isCloudSave(picked).catch(() => false);
  if (cloud && !(await confirmCloudWrite(picked))) return;
  if (await writeSave(() => ipc.saveAs(picked))) {
    noteSavedIntoPaintMod();
    void noteDuplicateNames();
  }
}

/**
 * The "now what": once the file the session just wrote sits inside the Paint a Galaxy mod's
 * scenarios folder, says how to find it in Stellaris. Silent when the header names no size yet.
 */
function noteSavedIntoPaintMod(): void {
  const { getState, setState } = useFileSessionStore;
  const { kind, path } = getState();
  const dir = paintScenariosDir();
  if (kind !== "scenario" || path === null || dir === null || !isUnder(path, dir)) return;
  const name = scenarioHeaderName(useGalaxyStore.getState().header);
  if (name === null) return;
  setState({
    notice:
      "Saved into the Paint a Galaxy mod. In Stellaris, start a new game, choose the Elliptical " +
      `shape and the size ${name}.`,
  });
}

/**
 * Resolves true when the document may be saved with its warnings and errors: every one of them
 * was already agreed to, or the user agreed now, with the Issues tab showing what they are.
 */
async function confirmIssues(): Promise<boolean> {
  const { getState, setState } = useFileSessionStore;
  const { issues, dismissedIssues, path, title } = getState();
  const unresolved = issues.filter((issue) => issue.severity !== "info" && !isNote(issue));
  const keys = unresolved.map(issueKey);
  if (keys.every((key) => dismissedIssues.includes(key))) return true;
  const layout = useLayoutStore.getState();
  layout.setTab("issues");
  if (layout.collapsed) layout.toggleDock();
  const count =
    unresolved.length === 1 ? "1 unresolved issue" : `${unresolved.length} unresolved issues`;
  const ok = await confirm(`This map has ${count}. Save anyway?`, {
    title: fileName(path) || (title ?? ""),
    kind: "warning",
    okLabel: "Save anyway",
    cancelLabel: "Cancel",
  });
  if (ok) setState({ dismissedIssues: [...new Set([...dismissedIssues, ...keys])] });
  return ok;
}

/** Resolves true when `path` may be written: already acknowledged this session, or the user agreed now. */
async function confirmCloudWrite(path: string): Promise<boolean> {
  const { getState, setState } = useFileSessionStore;
  if (getState().cloudAcknowledged === path) return true;
  const ok = await confirm(CLOUD_WARNING, { title: "Steam Cloud save", kind: "warning" });
  if (ok) setState({ cloudAcknowledged: path });
  return ok;
}

/**
 * Runs `write`, reporting its progress until it settles; `settle` says what its result changes.
 * Resolves true once the write landed, so a caller can act on a save that actually happened.
 */
async function runWrite<T>(
  write: () => Promise<T>,
  settle: (result: T) => Partial<FileSessionState>,
): Promise<boolean> {
  const { getState, setState } = useFileSessionStore;
  setState({ saving: true });
  let unlisten: (() => void) | null = null;
  let ok = false;
  try {
    unlisten = await onProgress((progress) => {
      if (getState().saving) setState({ progress });
    });
    const result = await write();
    setState({ ...settle(result), error: null, errorKind: null });
    ok = true;
  } catch (e) {
    setState({ error: ipc.errorMessage(e), errorKind: isSgfError(e) ? e.kind : null });
  } finally {
    unlisten?.();
    setState({ saving: false, progress: null });
  }
  return ok;
}

/** Writes the session to its own file: where it lands becomes the session's path. */
function writeSave(write: () => Promise<SaveResult>): Promise<boolean> {
  return runWrite(write, (result) => ({
    lastSave: result,
    path: result.path,
    cloud: result.cloud,
    dirty: result.dirty,
    savedAt: Date.now(),
  }));
}
