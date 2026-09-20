import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { isSgfError } from "../api/errors";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import type { Capabilities } from "../generated/Capabilities";
import type { DocumentKind } from "../generated/DocumentKind";
import type { ErrorKind } from "../generated/ErrorKind";
import type { Issue } from "../generated/Issue";
import type { OpenResult } from "../generated/OpenResult";
import type { Progress } from "../generated/Progress";
import type { SaveMeta } from "../generated/SaveMeta";
import type { SaveResult } from "../generated/SaveResult";
import { isPaintMade } from "../lib/paint";
import { fileName } from "../lib/paths";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
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
  path: string | null;
  /** The format of the open document; null until one is open. */
  kind: DocumentKind | null;
  /** The document's own name: the empire's, or the scenario's. */
  title: string | null;
  meta: SaveMeta | null;
  /** What the open document supports; null until one is open. */
  capabilities: Capabilities | null;
  issues: Issue[];
  dirty: boolean;
  saving: boolean;
  lastSave: SaveResult | null;
  /** When the last save landed, by the machine's own clock. */
  savedAt: number | null;
  /** The open file sits where Steam Cloud may overwrite it with its cloud copy. */
  cloud: boolean;
  /** The cloud path the user has already agreed to write this session. */
  cloudAcknowledged: string | null;
  /** A save waiting for the user to say which way to open it. */
  pendingOpen: string | null;
  /**
   * Whether new spawn points are written in Paint a Galaxy's shape: on when the open document
   * was painted, and otherwise the user's choice. Never changes bytes already written.
   */
  paintProfile: boolean;

  /** Resolves true when the document opened; false when it failed, or another open was in flight. */
  openSave(path: string): Promise<boolean>;
  /** Opens the save at `path` as a new, unsaved scenario; the save itself is untouched. */
  openScenarioFrom(path: string): Promise<boolean>;
  /** Starts an empty, unsaved scenario. */
  newScenario(name: string, radius: number, coreRadius: number): Promise<boolean>;
  /** Opens scenario `text`, as Paint a Galaxy sends it, as a new, unsaved scenario. */
  openScenarioText(name: string, text: string): Promise<boolean>;
  /** Opens `path`, asking first how a save is to be opened. */
  requestOpen(path: string): Promise<void>;
  /** Answers the pending open; null cancels it. */
  chooseOpenMode(mode: OpenMode | null): Promise<void>;
  /** With a `mode`, the picker filters to `.sav` and skips straight to that mode, no dialog. */
  pickAndOpen(mode?: OpenMode): Promise<void>;
  /** Re-reads the open file from disk, discarding unsaved changes on confirmation. */
  reload(): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  /** Writes the open save's galaxy as a scenario file beside it; the session stays on the save. */
  exportScenario(): Promise<void>;
  /** Resolves true when it is safe to discard the session: not dirty, or the user confirmed. */
  confirmDiscard(): Promise<boolean>;
  /** What an edit reported about the file it belongs to. */
  noteEdit(patch: { issues: Issue[]; dirty: boolean }): void;
  setError(message: string | null): void;
  setPaintProfile(on: boolean): void;
}

const INITIAL = {
  status: "empty" as Status,
  progress: null as Progress | null,
  loadingName: null as string | null,
  settling: false,
  error: null as string | null,
  errorKind: null as ErrorKind | null,
  path: null as string | null,
  kind: null as DocumentKind | null,
  title: null as string | null,
  meta: null as SaveMeta | null,
  capabilities: null as Capabilities | null,
  issues: [] as Issue[],
  dirty: false,
  saving: false,
  lastSave: null as SaveResult | null,
  savedAt: null as number | null,
  cloud: false,
  cloudAcknowledged: null as string | null,
  pendingOpen: null as string | null,
  paintProfile: false,
} satisfies Partial<FileSessionState>;

const CLOUD_WARNING =
  "This file is in Steam's cloud folder. Steam can overwrite it with the cloud copy. " +
  "Close Steam or disable Steam Cloud for Stellaris before you play it. Save anyway?";

export const useFileSessionStore = create<FileSessionState>((set, get) => ({
  ...INITIAL,

  openSave(path) {
    return openDocument(path, () => ipc.openSave(path));
  },

  openScenarioFrom(path) {
    return openDocument(null, () => ipc.openAsScenario(path), fileName(path));
  },

  async newScenario(name, radius, coreRadius) {
    if (get().saving || !(await get().confirmDiscard())) return false;
    return openDocument(null, () => ipc.newScenario(name, radius, coreRadius), name);
  },

  async openScenarioText(name, text) {
    if (get().saving || !(await get().confirmDiscard())) return false;
    return openDocument(null, () => ipc.openScenarioText(text), name);
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

  async reload() {
    const { path, saving } = get();
    if (path === null || saving || !(await get().confirmDiscard())) return;
    await get().openSave(path);
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
    if (cloud && !(await confirmCloudWrite(path))) return;
    await writeSave(() => ipc.save());
  },

  async saveAs() {
    const { status, saving, kind, path, title } = get();
    if (status !== "ready" || saving) return;
    const filter = kind === "scenario" ? SCENARIO_FILTER : SAVE_FILTER;
    const picked = await saveDialog({
      defaultPath: path ?? defaultName(title, filter.extensions[0]),
      filters: [filter],
    });
    if (picked === null) return;
    const cloud = await ipc.isCloudSave(picked).catch(() => false);
    if (cloud && !(await confirmCloudWrite(picked))) return;
    await writeSave(() => ipc.saveAs(picked));
  },

  async exportScenario() {
    const { status, saving, kind, title } = get();
    if (status !== "ready" || saving || kind !== "save") return;
    const picked = await saveDialog({
      defaultPath: defaultName(title, "txt"),
      filters: [SCENARIO_FILTER],
    });
    if (picked === null) return;
    // The export is a second file: the session keeps its own path, and its edits stay unsaved.
    await runWrite(
      () => ipc.exportScenario(picked),
      () => ({}),
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
    set({ issues, dirty, error: null, errorKind: null });
  },

  setError(message) {
    set({ error: message, errorKind: null });
  },

  setPaintProfile(on) {
    set({ paintProfile: on });
  },
}));

export function isSavePath(path: string): boolean {
  return path.toLowerCase().endsWith(".sav");
}

/** What a document with no file of its own is offered as a name. */
function defaultName(title: string | null, extension: string): string | undefined {
  return title === null ? undefined : `${title}.${extension}`;
}

/** The open a late answer still belongs to; a newer open leaves the older one's to nobody. */
let opens = 0;

/** The one path every open takes: `path` is the file it comes from, null for a new document. */
async function openDocument(
  path: string | null,
  load: () => Promise<OpenResult>,
  name?: string,
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
      paintProfile: isPaintMade(result.galaxy.systems),
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

/** Resolves true when `path` may be written: already acknowledged this session, or the user agreed now. */
async function confirmCloudWrite(path: string): Promise<boolean> {
  const { getState, setState } = useFileSessionStore;
  if (getState().cloudAcknowledged === path) return true;
  const ok = await confirm(CLOUD_WARNING, { title: "Steam Cloud save", kind: "warning" });
  if (ok) setState({ cloudAcknowledged: path });
  return ok;
}

/** Runs `write`, reporting its progress until it settles; `settle` says what its result changes. */
async function runWrite(
  write: () => Promise<SaveResult>,
  settle: (result: SaveResult) => Partial<FileSessionState>,
): Promise<void> {
  const { getState, setState } = useFileSessionStore;
  setState({ saving: true });
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await onProgress((progress) => {
      if (getState().saving) setState({ progress });
    });
    const result = await write();
    setState({ ...settle(result), lastSave: result, error: null, errorKind: null });
  } catch (e) {
    setState({ error: ipc.errorMessage(e), errorKind: isSgfError(e) ? e.kind : null });
  } finally {
    unlisten?.();
    setState({ saving: false, progress: null });
  }
}

/** Writes the session to its own file: where it lands becomes the session's path. */
function writeSave(write: () => Promise<SaveResult>): Promise<void> {
  return runWrite(write, (result) => ({
    path: result.path,
    cloud: result.cloud,
    dirty: result.dirty,
    savedAt: Date.now(),
  }));
}
