import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { CampaignListing } from "../generated/CampaignListing";
import type { GalaxySettings } from "../generated/GalaxySettings";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import { campaignsToRead, type OpenLists, type OpenTab } from "../lib/openRows";
import { useFileSessionStore, type OpenMode } from "./fileSessionStore";
import { useLayoutStore } from "./layoutStore";
import { useRecentsStore } from "./recentsStore";

/** A save's galaxy settings as the details pane has them: still reading, read, or failed. */
export type SaveDetails =
  | { status: "loading" }
  | { status: "ready"; settings: GalaxySettings }
  | { status: "error"; message: string };

/** One read per file version: a save written since reads again. */
export function detailsKey(path: string, modified: number): string {
  return `${modified}:${path}`;
}

export interface OpenScreenState extends OpenLists {
  /** The path of the row a document is being opened from. */
  busy: string | null;
  rowError: { path: string; message: string } | null;
  /** Galaxy settings by `detailsKey`. */
  details: Record<string, SaveDetails>;

  setFilter(filter: string): void;
  setTab(tab: OpenTab): void;
  /** Reads the galaxy settings of the save at `path` once per `modified`. */
  loadDetails(path: string, modified: number): Promise<void>;
  /**
   * Reads both lists again, since the game writes saves while the app runs, keeping the open
   * campaign while it is still there; a call while a read is under way joins it.
   */
  load(): Promise<void>;
  /** Expands one campaign folder, reading its saves the first time. */
  expand(dir: string): Promise<void>;
  collapse(): void;
  toggle(dir: string): Promise<void>;
  /**
   * Opens `path` as a save or as a scenario, reporting failure on the row it came from. A
   * scenario file asks the Paint a Galaxy question first where it has to, and `asPaint` opens
   * it for the mod whatever the file says.
   */
  open(path: string, mode: OpenMode, asPaint?: boolean): Promise<void>;
  forget(path: string): void;
  /** Empties the recent list. */
  clear(): void;
}

const INITIAL = {
  filter: "",
  tab: "all" as OpenTab,
  campaigns: null as CampaignListing[] | null,
  campaignsError: null as string | null,
  scenarios: null as ScenarioListing[] | null,
  scenariosError: null as string | null,
  scenarioNotices: [] as string[],
  files: {} as Record<string, SaveFile[]>,
  fileErrors: {} as Record<string, string>,
  expanded: null as string | null,
  loadingDirs: [] as string[],
  missing: [] as string[],
  busy: null as string | null,
  rowError: null as { path: string; message: string } | null,
  details: {} as Record<string, SaveDetails>,
};

/**
 * The read the lists come from, its promise while it is under way, and the campaign folders
 * asked for since it started, a failed one included.
 */
let readFor: unknown = Symbol("unread");
let reading: Promise<void> | null = null;
const listedDirs = new Set<string>();
const readingDetails = new Map<string, Promise<void>>();

/** Drops everything read so far; the next `load` reads again. */
export function resetOpenScreen(): void {
  readFor = Symbol("unread");
  reading = null;
  listedDirs.clear();
  readingDetails.clear();
  useOpenScreenStore.setState({ ...INITIAL });
}

/**
 * File → Open…: the dialog over an open document, or, while the Open screen already shows as
 * the start screen or the dialog, its lists read again.
 */
export function showOpenScreen(): void {
  const layout = useLayoutStore.getState();
  if (useFileSessionStore.getState().status === "ready" && !layout.openDialog) {
    layout.showOpenDialog();
    return;
  }
  void useOpenScreenStore.getState().load();
}

/** Reads the lists again each time the window regains focus, as after the game saved; returns the stop. */
export function watchWindowFocus(): () => void {
  const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) void useOpenScreenStore.getState().load();
  });
  return () => void unlisten.then((stop) => stop());
}

/** What a refused open says when the session named no failure of its own. */
const ANOTHER_OPENING = "Another document is still opening.";

export const useOpenScreenStore = create<OpenScreenState>((set, get) => ({
  ...INITIAL,

  setFilter(filter) {
    set({ filter });
    void listSavesToFilter();
  },

  setTab(tab) {
    set({ tab });
  },

  loadDetails(path, modified) {
    const key = detailsKey(path, modified);
    const pending = readingDetails.get(key);
    if (pending) return pending;
    if (get().details[key] !== undefined) return Promise.resolve();
    const put = (entry: SaveDetails) => set({ details: { ...get().details, [key]: entry } });
    put({ status: "loading" });
    const read = ipc.saveDetails(path).then(
      (settings) => put({ status: "ready", settings }),
      (e: unknown) => put({ status: "error", message: ipc.errorMessage(e) }),
    );
    readingDetails.set(key, read);
    return read.finally(() => readingDetails.delete(key));
  },

  load() {
    if (reading) return reading;
    const token = Symbol("read");
    readFor = token;
    listedDirs.clear();
    const { files, expanded } = get();
    const shown = expanded !== null ? files[expanded] : undefined;
    set({ files: shown && expanded ? { [expanded]: shown } : {}, fileErrors: {}, loadingDirs: [] });
    reading = read(token).finally(() => {
      if (token === readFor) reading = null;
    });
    return reading;
  },

  expand(dir) {
    set({ expanded: dir });
    return listSaves(dir);
  },

  collapse() {
    set({ expanded: null });
  },

  toggle(dir) {
    if (get().expanded === dir) {
      get().collapse();
      return Promise.resolve();
    }
    return get().expand(dir);
  },

  async open(path, mode, asPaint = false) {
    if (get().busy !== null) return;
    set({ busy: path, rowError: null });
    const outcome = await useFileSessionStore
      .getState()
      .openPath(path, mode, { asPaint, listings: get().scenarios })
      .finally(() => set({ busy: null }));
    if (outcome === "opened") {
      useLayoutStore.getState().hideOpenDialog();
      return;
    }
    if (outcome === "cancelled") return;
    const failed = useFileSessionStore.getState();
    const message = failed.error ?? ANOTHER_OPENING;
    const missing = failed.errorKind === "not_found" && !get().missing.includes(path);
    set({
      rowError: { path, message },
      missing: missing ? [...get().missing, path] : get().missing,
    });
  },

  forget(path) {
    useRecentsStore.getState().forget(path);
    set({ missing: get().missing.filter((p) => p !== path) });
  },

  clear() {
    useRecentsStore.getState().clear();
    set({ missing: [] });
  },
}));

/**
 * Both lists read for `token`, each reporting its own failure, the recent documents whose files
 * are gone forgotten, and the open campaign read again, or the newest opened once it is gone; a
 * read a newer token overtook writes nothing.
 */
async function read(token: unknown): Promise<void> {
  const { getState } = useOpenScreenStore;
  const setState = (state: Partial<OpenScreenState>) => {
    if (token === readFor) useOpenScreenStore.setState(state);
  };
  await Promise.all([
    ipc.listCampaigns().then(
      (campaigns) =>
        setState({
          campaigns: [...campaigns].sort((a, b) => b.newest - a.newest),
          campaignsError: null,
        }),
      (e: unknown) => setState({ campaigns: [], campaignsError: ipc.errorMessage(e) }),
    ),
    ipc.listScenarios().then(
      (listed) =>
        setState({
          scenarios: listed.scenarios,
          scenarioNotices: listed.diagnostics,
          scenariosError: null,
        }),
      (e: unknown) =>
        setState({ scenarios: [], scenarioNotices: [], scenariosError: ipc.errorMessage(e) }),
    ),
    forgetMissingRecents(token),
  ]);
  if (token !== readFor) return;
  const { campaigns, expanded } = getState();
  const open = campaigns?.find((c) => c.dir === expanded) ?? campaigns?.[0];
  if (open) await Promise.all([getState().expand(open.dir), listSavesToFilter()]);
  else setState({ expanded: null });
}

/**
 * Reads the saves of the campaign folder `dir` once per read of the lists, whether or not the
 * folder could be listed; the saves an earlier read found stay until these replace them.
 */
async function listSaves(dir: string): Promise<void> {
  const { getState: get, setState: set } = useOpenScreenStore;
  if (listedDirs.has(dir)) return;
  listedDirs.add(dir);
  set({ loadingDirs: [...get().loadingDirs, dir] });
  const token = readFor;
  try {
    const files = await ipc.listCampaignSaves(dir);
    if (token !== readFor) return;
    const fileErrors = { ...get().fileErrors };
    delete fileErrors[dir];
    set({ files: { ...get().files, [dir]: byNewest(files) }, fileErrors });
  } catch (e) {
    if (token !== readFor) return;
    set({ fileErrors: { ...get().fileErrors, [dir]: ipc.errorMessage(e) } });
  } finally {
    if (token === readFor) set({ loadingDirs: get().loadingDirs.filter((d) => d !== dir) });
  }
}

/** The saves of each campaign the filter keeps by what is known of them before they are read. */
async function listSavesToFilter(): Promise<void> {
  const dirs = campaignsToRead(useOpenScreenStore.getState());
  await Promise.all(dirs.map(listSaves));
}

/** Drops the recent documents whose files are gone; a failed check leaves the list alone. */
async function forgetMissingRecents(token: unknown): Promise<void> {
  const paths = useRecentsStore.getState().recents.map((r) => r.path);
  if (paths.length === 0) return;
  try {
    const gone = await ipc.missingPaths(paths);
    if (token === readFor && gone.length > 0) useRecentsStore.getState().forgetAll(gone);
  } catch {
    return;
  }
}

function byNewest(files: SaveFile[]): SaveFile[] {
  return [...files].sort((a, b) => b.modified - a.modified);
}
