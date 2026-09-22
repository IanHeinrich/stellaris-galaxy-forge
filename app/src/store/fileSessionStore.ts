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
import type { AppIssue } from "../lib/issues";
import {
  paintLayer,
  scenarioForPaint,
  scenarioOpenPrompt,
  type ScenarioOpenPrompt,
} from "../lib/paint";
import { fileName, joinPath } from "../lib/paths";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import {
  RESERVED_SPAWNS,
  isNote,
  issueKey,
  noteDuplicateNames,
  noteGalaxySize,
  noteReservedSpawns,
  useIssuesStore,
} from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { useOpenScreenStore } from "./openScreenStore";
import {
  noteSavedIntoPaintMod,
  paintScenariosDir,
  standingProfile,
  usePaintModStore,
} from "./paintModStore";
import { recentSubtitle, useRecentsStore } from "./recentsStore";

export type Status = "empty" | "loading" | "ready" | "error";

/** What a picked save is opened as: edited in place, or taken as the start of a scenario. */
export type OpenMode = "save" | "scenario";

/** What the user says to a save that found issues: go and look, write it anyway, or stop. */
export type SaveIssuesAnswer = "review" | "save" | "cancel";

/** A save waiting on that answer; `resolve` hands it back to the save that asked. */
export interface SaveIssuesPrompt {
  count: number;
  resolve(answer: SaveIssuesAnswer): void;
}

/**
 * A scenario file waiting on the Paint a Galaxy question before it opens; `resolve` hands back
 * the profile it opens under, or null when the user cancelled.
 */
export interface ScenarioPrompt {
  path: string;
  kind: Exclude<ScenarioOpenPrompt, "none">;
  /** The user asked to open it for the mod, whatever the file says. */
  forPaint: boolean;
  resolve(profile: ScenarioProfile | null): void;
}

/** A save the user left to go and look at the issues, and what it takes to pick it up again. */
export interface PausedSave {
  count: number;
  /** The issues it stopped on, agreed to when the save is picked up again. */
  keys: string[];
  resume(): Promise<void>;
}

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
  /** A save waiting for the user to say what to do about the issues it found. */
  saveIssuesPrompt: SaveIssuesPrompt | null;
  /** The save the user left to go and look at the issues; null when none is waiting. */
  pausedSave: PausedSave | null;
  /** A save waiting for the user to say which way to open it. */
  pendingOpen: string | null;
  /** A scenario file waiting for the user to answer the Paint a Galaxy question. */
  scenarioPrompt: ScenarioPrompt | null;
  /** What an export would carry over, waiting for the user to confirm or cancel it. */
  pendingExport: ExportReport | null;
  /** The open scenario carries Paint a Galaxy's scripts or flags, or Forge's header for the mod. */
  painted: boolean;
  /** The open scenario was started or opened under the mod's profile, whatever its bytes say. */
  paintChosen: boolean;

  /**
   * Resolves true when the document opened; false when it failed, or another open was in flight.
   * A scenario file is taken as written under `profile`; left out, as its bytes say.
   */
  openSave(path: string, profile?: ScenarioProfile): Promise<boolean>;
  /** Opens the scenario file at `path`, taken as written under `profile`; left out, as its bytes say. */
  openScenario(path: string, profile?: ScenarioProfile): Promise<boolean>;
  /** Opens the save at `path` as a new, unsaved scenario under `profile`; the save itself is untouched. */
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
  /** Answers the Paint a Galaxy question with the profile to open under; null cancels the open. */
  answerScenarioPrompt(profile: ScenarioProfile | null): void;
  /**
   * With a `mode`, the picker filters to `.sav` and skips straight to that mode, no dialog;
   * `profile` is what a scenario made from the pick is written under, the standing choice
   * when left out.
   */
  pickAndOpen(mode?: OpenMode, profile?: ScenarioProfile): Promise<void>;
  /** Re-reads the open file from disk, discarding unsaved changes on confirmation. */
  reload(): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;
  /** Asks where the file goes, starting at `defaultPath`; left out, its own path or a name for it. */
  saveAs(defaultPath?: string): Promise<void>;
  /** Previews what exporting the open save carries over, and asks whether to write it. */
  exportScenario(): Promise<void>;
  /** Answers the pending export: writes the scenario under `profile`, or cancels on null. */
  confirmExport(profile: ScenarioProfile | null): Promise<void>;
  /** Resolves true when it is safe to discard the session: not dirty, or the user confirmed. */
  confirmDiscard(): Promise<boolean>;
  /** Answers the dialog a save raised over its issues. */
  answerSaveIssues(answer: SaveIssuesAnswer): void;
  /** Writes the paused save, with the issues it stopped on already agreed to. */
  resumePausedSave(): Promise<void>;
  /** Drops the paused save, writing nothing and agreeing to nothing. */
  dismissPausedSave(): void;
  /** What an edit reported about the file it belongs to. */
  noteEdit(patch: { issues: Issue[]; dirty: boolean }): void;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
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
  dirty: false,
  saving: false,
  lastSave: null as SaveResult | null,
  lastExport: null as ExportResult | null,
  exportedAt: null as number | null,
  savedAt: null as number | null,
  cloud: false,
  cloudAcknowledged: null as string | null,
  dismissedIssues: [] as string[],
  saveIssuesPrompt: null as SaveIssuesPrompt | null,
  pausedSave: null as PausedSave | null,
  pendingOpen: null as string | null,
  scenarioPrompt: null as ScenarioPrompt | null,
  pendingExport: null as ExportReport | null,
  painted: false,
  paintChosen: false,
} satisfies Partial<FileSessionState>;

const CLOUD_WARNING =
  "This file is in Steam's cloud folder. Steam can overwrite it with the cloud copy. " +
  "Close Steam or disable Steam Cloud for Stellaris before you play it. Save anyway?";

export const useFileSessionStore = create<FileSessionState>((set, get) => ({
  ...INITIAL,

  openSave(path, profile) {
    return openDocument(path, () => ipc.openSave(path), { profile });
  },

  async openScenario(path, profile) {
    if (get().saving || !(await get().confirmDiscard())) return false;
    return get().openSave(path, profile);
  },

  openScenarioFrom(path, profile = "plain") {
    return openDocument(null, () => ipc.openAsScenario(path, profile), {
      name: fileName(path),
      profile,
    });
  },

  async newScenario(name, radius, coreRadius, profile = "plain") {
    if (get().saving || !(await get().confirmDiscard())) return false;
    return openDocument(null, () => ipc.newScenario(name, radius, coreRadius, profile), {
      name,
      profile,
    });
  },

  async requestOpen(path) {
    if (get().saving || !(await get().confirmDiscard())) return;
    await routeOpen(path);
  },

  async chooseOpenMode(mode) {
    const path = get().pendingOpen;
    set({ pendingOpen: null });
    if (path === null || mode === null) return;
    await (mode === "scenario"
      ? get().openScenarioFrom(path, standingProfile())
      : get().openSave(path));
  },

  answerScenarioPrompt(profile) {
    const prompt = get().scenarioPrompt;
    set({ scenarioPrompt: null });
    prompt?.resolve(profile);
  },

  async pickAndOpen(mode, profile = standingProfile()) {
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
      await (mode === "scenario"
        ? get().openScenarioFrom(picked, profile)
        : get().openSave(picked));
    }
  },

  async reload() {
    const { path, saving, paintChosen } = get();
    if (path === null || saving || !(await get().confirmDiscard())) return;
    // What the user said of the file when opening it is not in its bytes, so it is said again.
    await openDocument(path, () => ipc.openSave(path), {
      profile: paintChosen ? "paint_a_galaxy" : "plain",
    });
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
    if (!(await confirmIssues(() => get().save()))) return;
    if (cloud && !(await confirmCloudWrite(path))) return;
    if (await writeSave(() => ipc.save())) void noteDuplicateNames();
  },

  async saveAs(defaultPath) {
    const { status, saving, kind, path, title } = get();
    if (status !== "ready" || saving) return;
    const filter = kind === "scenario" ? SCENARIO_FILTER : SAVE_FILTER;
    await saveTo(
      defaultPath ?? path ?? newFilePath(title, filter.extensions[0], getPaintLayer()),
      filter,
    );
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

  answerSaveIssues(answer) {
    const prompt = get().saveIssuesPrompt;
    if (prompt === null) return;
    set({ saveIssuesPrompt: null });
    prompt.resolve(answer);
  },

  async resumePausedSave() {
    const { pausedSave, dismissedIssues } = get();
    if (pausedSave === null) return;
    set({
      pausedSave: null,
      dismissedIssues: [...new Set([...dismissedIssues, ...pausedSave.keys])],
    });
    await pausedSave.resume();
  },

  dismissPausedSave() {
    if (get().pausedSave !== null) set({ pausedSave: null });
  },

  noteEdit({ issues, dirty }) {
    set({ dirty, error: null, errorKind: null });
    useIssuesStore.getState().setFindings(issues);
    // A seat's kind can change with an edit, so the reserved seats are counted again.
    noteReservedSpawns();
    noteGalaxySize();
  },

  setError(message) {
    set({ error: message, errorKind: null });
  },

  setNotice(message) {
    set({ notice: message });
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

/** What a document with no file of its own is offered as a name. */
function defaultName(title: string | null, extension: string): string | undefined {
  return title === null ? undefined : `${title}.${extension}`;
}

/** Where a new file is offered: inside the mod's scenarios folder when it is written for the mod. */
function newFilePath(title: string | null, extension: string, forPaintMod: boolean) {
  const name = defaultName(title, extension);
  const dir = forPaintMod ? paintScenariosDir() : null;
  return dir !== null && name !== undefined ? joinPath(dir, name) : name;
}

/** The open a late answer still belongs to; a newer open leaves the older one's to nobody. */
let opens = 0;

/** What an open says of its document beyond its bytes: the name it loads under, and its profile. */
interface OpenOptions {
  /** Named for the loading overlay; left out, the file's own name. */
  name?: string;
  /** What the document is written under; left out, the layer follows its bytes alone. */
  profile?: ScenarioProfile;
}

/**
 * The one path every open takes: `path` is the file it comes from, null for a new document, and
 * `profile` what it is written under, which a file with no systems yet cannot show.
 */
async function openDocument(
  path: string | null,
  load: () => Promise<OpenResult>,
  { name, profile }: OpenOptions = {},
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
      painted: result.painted,
      paintChosen: profile === "paint_a_galaxy",
    });
    useIssuesStore.getState().load(result.issues);
    if (result.path !== null) {
      useRecentsStore.getState().noteOpened({
        kind: result.kind,
        path: result.path,
        title: result.title,
        subtitle: recentSubtitle(result.kind, result.meta, result.galaxy.systems.length),
      });
    }
    useGalaxyStore.getState().load(result.galaxy);
    noteReservedSpawns();
    noteGalaxySize();
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

/**
 * The profile the scenario file at `path` opens under, once the Paint a Galaxy question is
 * answered where it has to be asked; null when the user cancelled.
 */
export function askScenarioOpen(path: string, asPaint = false): Promise<ScenarioProfile | null> {
  const { paintMod, warnNotForPaint } = usePaintModStore.getState();
  const forPaint =
    asPaint || scenarioForPaint(path, useOpenScreenStore.getState().scenarios, paintMod);
  const kind = scenarioOpenPrompt(forPaint, paintMod, warnNotForPaint);
  const profile: ScenarioProfile = asPaint ? "paint_a_galaxy" : "plain";
  if (kind === "none") return Promise.resolve(profile);
  return new Promise((resolve) => {
    useFileSessionStore.setState({
      scenarioPrompt: {
        path,
        kind,
        forPaint: asPaint,
        resolve: (answer) => resolve(answer === null ? null : asPaint ? profile : answer),
      },
    });
  });
}

/** A scenario opens once any Paint a Galaxy question is answered; a save first asks how to open it. */
async function routeOpen(path: string): Promise<void> {
  const { getState, setState } = useFileSessionStore;
  if (!isSavePath(path)) {
    const profile = await askScenarioOpen(path);
    if (profile !== null) await getState().openSave(path, profile);
    return;
  }
  setState({ pendingOpen: path });
}

/** Asks where the file goes, starting at `defaultPath`, and writes it there. */
async function saveTo(
  defaultPath: string | undefined,
  filter: { name: string; extensions: string[] },
): Promise<void> {
  if (!(await confirmIssues(() => saveTo(defaultPath, filter)))) return;
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
 * Whether saving with `issue` unresolved is worth a question: a warning or error the validator
 * found, or the one note under which the map will not play as designed.
 */
function blocksSave(issue: AppIssue): boolean {
  if (issue.severity === "info") return false;
  return !isNote(issue) || issue.code === RESERVED_SPAWNS;
}

/**
 * Resolves true when the document may be saved with its warnings and errors: every one of them
 * was already agreed to, or the user agreed now. `resume` is the save itself, kept for the bar
 * the Issues tab shows when the user goes to look at them instead.
 */
async function confirmIssues(resume: () => Promise<void>): Promise<boolean> {
  const { getState, setState } = useFileSessionStore;
  const { dismissedIssues, saveIssuesPrompt } = getState();
  if (saveIssuesPrompt !== null) return false;
  const unresolved = useIssuesStore.getState().issues.filter(blocksSave);
  const keys = unresolved.map(issueKey);
  if (keys.every((key) => dismissedIssues.includes(key))) return true;
  const count = unresolved.length;
  const answer = await new Promise<SaveIssuesAnswer>((resolve) => {
    setState({ saveIssuesPrompt: { count, resolve } });
  });
  if (answer === "save") {
    setState({ dismissedIssues: [...new Set([...dismissedIssues, ...keys])] });
    return true;
  }
  if (answer === "review") {
    const layout = useLayoutStore.getState();
    layout.setTab("issues");
    if (layout.collapsed) layout.toggleDock();
    useIssuesStore.getState().flash();
    setState({ pausedSave: { count, keys, resume } });
  }
  return false;
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
    pausedSave: null,
  }));
}
