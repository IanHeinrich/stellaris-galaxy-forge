import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { CampaignListing } from "../generated/CampaignListing";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { OpenLists } from "../lib/openRows";
import { useFileSessionStore, type OpenMode } from "./fileSessionStore";
import { useLayoutStore } from "./layoutStore";
import { useRecentsStore } from "./recentsStore";

export interface OpenScreenState extends OpenLists {
  /** The path of the row a document is being opened from. */
  busy: string | null;
  rowError: { path: string; message: string } | null;

  setFilter(filter: string): void;
  /** Reads both lists once; a new `token` means the save folders were written to since. */
  load(token: unknown): Promise<void>;
  /** Expands one campaign folder, reading its saves the first time. */
  expand(dir: string): Promise<void>;
  collapse(): void;
  toggle(dir: string): Promise<void>;
  /** Opens `path` as a save or as a scenario, reporting failure on the row it came from. */
  open(path: string, mode: OpenMode): Promise<void>;
  forget(path: string): void;
}

const INITIAL = {
  filter: "",
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
};

/** The session state the lists were read for, and the read itself, so it happens once. */
let readFor: unknown = Symbol("unread");
let reading: Promise<void> | null = null;
const readingFiles = new Set<string>();

/** Drops everything read so far; the next `load` reads again. */
export function resetOpenScreen(): void {
  readFor = Symbol("unread");
  reading = null;
  readingFiles.clear();
  useOpenScreenStore.setState({ ...INITIAL });
}

/** What a refused open says when the session named no failure of its own. */
const ANOTHER_OPENING = "Another document is still opening.";

export const useOpenScreenStore = create<OpenScreenState>((set, get) => ({
  ...INITIAL,

  setFilter(filter) {
    set({ filter });
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

  async open(path, mode) {
    const session = useFileSessionStore.getState();
    if (get().busy !== null || session.saving || !(await session.confirmDiscard())) return;
    set({ busy: path, rowError: null });
    const opening = mode === "scenario" ? session.openScenarioFrom(path) : session.openSave(path);
    const opened = await opening.finally(() => set({ busy: null }));
    if (opened) {
      useLayoutStore.getState().hideOpenDialog();
      return;
    }
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
