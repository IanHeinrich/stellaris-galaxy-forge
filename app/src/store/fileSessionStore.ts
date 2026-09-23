import { confirm, open } from "@tauri-apps/plugin-dialog";
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
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { documentCapabilities, supports } from "../lib/capabilities";
import {
  paintLayer,
  scenarioForPaint,
  scenarioOpenPrompt,
  type ScenarioOpenPrompt,
} from "../lib/paint";
import { fileName } from "../lib/paths";
import { saveGateActions } from "./fileSessionStore.saveGate";
import { SAVE_FILTER, SCENARIO_FILTER, writeActions } from "./fileSessionStore.writes";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useIssuesStore } from "./issuesStore";
import { standingProfile, usePaintModStore } from "./paintModStore";
import { recentSubtitle, useRecentsStore } from "./recentsStore";

export type Status = "empty" | "loading" | "ready" | "error";

/** What a picked save is opened as: edited in place, or taken as the start of a scenario. */
export type OpenMode = "save" | "scenario";

/** How an open the user asked for ended: the document opened, it failed, or nothing happened. */
export type OpenOutcome = "opened" | "failed" | "cancelled";

/** What the caller knows of a file it asks to open, beyond its path. */
export interface OpenRequest {
  /** Open a scenario file for the Paint a Galaxy mod, whatever the file says. */
  asPaint?: boolean;
  /** Take a save straight into a new scenario; only the Paint a Galaxy choice is asked. */
  asScenario?: boolean;
  /** The scenarios the Open screen lists, which say whether a file outside the mod is for it. */
  listings: readonly ScenarioListing[] | null;
}

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
  /** The pending save is already taken as a scenario, so only the Paint a Galaxy choice is asked. */
  pendingAsScenario: boolean;
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
  /**
   * Opens `path` as a save, a scenario file, or a save taken into a new scenario, once any
   * unsaved changes are agreed to go and any Paint a Galaxy question is answered.
   */
  openPath(path: string, mode: OpenMode, request: OpenRequest): Promise<OpenOutcome>;
  /** Opens `path`, asking first how a save is to be opened, or only the Paint a Galaxy choice. */
  requestOpen(path: string, request: OpenRequest): Promise<void>;
  /** Answers the pending open; null cancels it. */
  chooseOpenMode(mode: OpenMode | null): Promise<void>;
  /** Answers the Paint a Galaxy question with the profile to open under; null cancels the open. */
  answerScenarioPrompt(profile: ScenarioProfile | null): void;
  /**
   * Picks a save and opens it as `mode`, no dialog; `profile` is what a scenario made from the
   * pick is written under, the standing choice when left out.
   */
  pickAndOpen(mode: OpenMode, profile?: ScenarioProfile): Promise<void>;
  /** Picks a save or a scenario file and routes it as `requestOpen` does, over the Open screen's `listings`. */
  pickAndOpen(
    mode: undefined,
    profile: undefined,
    listings: readonly ScenarioListing[] | null,
  ): Promise<void>;
  /** Re-reads the open file from disk, discarding unsaved changes on confirmation. */
  reload(): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;
  /** Asks where the file goes, starting at `defaultPath`; left out, its own path or a name for it. */
  saveAs(defaultPath?: string): Promise<void>;
  /** Save As into the mod's scenarios folder under the file's own name; nothing while that folder is unknown. */
  saveIntoPaintMod(): Promise<void>;
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
  pendingAsScenario: false,
  scenarioPrompt: null as ScenarioPrompt | null,
  pendingExport: null as ExportReport | null,
  painted: false,
  paintChosen: false,
} satisfies Partial<FileSessionState>;

export const useFileSessionStore = create<FileSessionState>((set, get, session) => ({
  ...INITIAL,
  ...writeActions(session, () => opens),
  ...saveGateActions(session),

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

  async openPath(path, mode, { asPaint = false, listings }) {
    if (get().saving || !(await get().confirmDiscard())) return "cancelled";
    return openAs(path, mode, asPaint, listings);
  },

  async requestOpen(path, { asScenario = false, listings }) {
    if (get().saving || !(await get().confirmDiscard())) return;
    if (asScenario) set({ pendingOpen: path, pendingAsScenario: true });
    else await routeOpen(path, listings);
  },

  async chooseOpenMode(mode) {
    const path = get().pendingOpen;
    set({ pendingOpen: null, pendingAsScenario: false });
    if (path === null || mode === null) return;
    await openAs(path, mode, false, null);
  },

  answerScenarioPrompt(profile) {
    const prompt = get().scenarioPrompt;
    set({ scenarioPrompt: null });
    prompt?.resolve(profile);
  },

  async pickAndOpen(
    mode?: OpenMode,
    profile: ScenarioProfile = standingProfile(),
    listings: readonly ScenarioListing[] | null = null,
  ) {
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
      await routeOpen(picked, listings);
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
    set({ dirty, error: null, errorKind: null });
    useIssuesStore.getState().setFindings(issues);
  },

  setError(message) {
    set({ error: message, errorKind: null });
  },

  setNotice(message) {
    set({ notice: message });
  },
}));

/** Whether the open document supports `cap`; everything until a document reports what it supports. */
export function canEdit(cap: keyof Capabilities): boolean {
  return supports(documentCapabilities(useFileSessionStore.getState()), cap);
}

/** The same fact, for a component. */
export function useCanEdit(cap: keyof Capabilities): boolean {
  return useFileSessionStore((s) => supports(documentCapabilities(s), cap));
}

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
    useGameDataStore.getState().onSaveClosed();
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
 * answered where it has to be asked; null when the user cancelled. A file no listing covers is
 * read from disk for its dialect.
 */
export async function askScenarioOpen(
  path: string,
  listings: readonly ScenarioListing[] | null,
  asPaint = false,
): Promise<ScenarioProfile | null> {
  const { paintMod, warnNotForPaint } = usePaintModStore.getState();
  const forPaint =
    asPaint ||
    (scenarioForPaint(path, listings, paintMod) ??
      (await ipc.scenarioPainted(path).catch(() => null)));
  const kind = scenarioOpenPrompt(forPaint, paintMod, warnNotForPaint);
  const profile: ScenarioProfile = asPaint ? "paint_a_galaxy" : "plain";
  if (kind === "none") return profile;
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
async function routeOpen(path: string, listings: readonly ScenarioListing[] | null): Promise<void> {
  if (isSavePath(path))
    useFileSessionStore.setState({ pendingOpen: path, pendingAsScenario: false });
  else await openAs(path, "save", false, listings);
}

/**
 * Opens `path` once its discard is agreed to: a save as itself or taken into a new scenario, a
 * scenario file once any Paint a Galaxy question is answered.
 */
async function openAs(
  path: string,
  mode: OpenMode,
  asPaint: boolean,
  listings: readonly ScenarioListing[] | null,
): Promise<OpenOutcome> {
  const { getState } = useFileSessionStore;
  let opened: boolean;
  if (mode === "scenario") {
    opened = await getState().openScenarioFrom(path, standingProfile());
  } else if (isSavePath(path)) {
    opened = await getState().openSave(path);
  } else {
    const profile = await askScenarioOpen(path, listings, asPaint);
    if (profile === null) return "cancelled";
    opened = await getState().openSave(path, profile);
  }
  return opened ? "opened" : "failed";
}
