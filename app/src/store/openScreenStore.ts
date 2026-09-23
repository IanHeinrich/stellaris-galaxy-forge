import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { CampaignListing } from "../generated/CampaignListing";
import type { GalaxySettings } from "../generated/GalaxySettings";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { OpenLists, OpenTab } from "../lib/openRows";
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
  /** Reads both lists once; a new `token` means the save folders were written to since. */
  load(token: unknown): Promise<void>;
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
  loadingDir: null as string | null,
  missing: [] as string[],
  busy: null as string | null,
  rowError: null as { path: string; message: string } | null,
  details: {} as Record<string, SaveDetails>,
};

/** The session state the lists were read for, and the read itself, so it happens once. */
let readFor: unknown = Symbol("unread");
let reading: Promise<void> | null = null;
const readingFiles = new Set<string>();
const readingDetails = new Map<string, Promise<void>>();

/** Drops everything read so far; the next `load` reads again. */
export function resetOpenScreen(): void {
  readFor = Symbol("unread");
  reading = null;
  readingFiles.clear();
  readingDetails.clear();
  useOpenScreenStore.setState({ ...INITIAL });
}

/** What a refused open says when the session named no failure of its own. */
const ANOTHER_OPENING = "Another document is still opening.";

export const useOpenScreenStore = create<OpenScreenState>((set, get) => ({
  ...INITIAL,

  setFilter(filter) {
    set({ filter });
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

  load(token) {
    if (token !== readFor) {
      readFor = token;
      reading = null;
      readingFiles.clear();
      set({ files: {}, fileErrors: {}, expanded: null });
    }
    reading ??= read();
    return reading;
  },

  async expand(dir) {
    set({ expanded: dir });
    if (get().files[dir] !== undefined || readingFiles.has(dir)) return;
    readingFiles.add(dir);
    set({ loadingDir: dir });
    try {
      const files = await ipc.listCampaignSaves(dir);
      const fileErrors = { ...get().fileErrors };
      delete fileErrors[dir];
      set({ files: { ...get().files, [dir]: byNewest(files) }, fileErrors });
    } catch (e) {
      readingFiles.delete(dir);
      set({ fileErrors: { ...get().fileErrors, [dir]: ipc.errorMessage(e) } });
    } finally {
      if (get().loadingDir === dir) set({ loadingDir: null });
    }
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
}));

/** Both lists, each reporting its own failure, and the newest campaign opened. */
async function read(): Promise<void> {
  const { getState, setState } = useOpenScreenStore;
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
  ]);
  const newest = getState().campaigns?.[0];
  if (newest && getState().expanded === null) await getState().expand(newest.dir);
}

function byNewest(files: SaveFile[]): SaveFile[] {
  return [...files].sort((a, b) => b.modified - a.modified);
}
