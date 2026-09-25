import { create } from "zustand";
import { onUpdateProgress } from "../api/events";
import { errorMessage } from "../api/errors";
import * as ipc from "../api/ipc";
import type { UpdateProgress } from "../generated/UpdateProgress";
import type { UpdateView } from "../generated/UpdateView";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isString, prefField } from "./prefs";

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing" | "failed";

export interface UpdateState {
  status: UpdateStatus;
  /** The running version: seeded from the package, then what the last check compared against. */
  version: string | null;
  update: UpdateView | null;
  /** Where the releases live: the constant the app ships with until a check names it. */
  releasesUrl: string;
  progress: UpdateProgress | null;
  error: string | null;
  dialog: boolean;
  /** The version the user asked not to be told about again; `""` when there is none. */
  skipped: string;
  /** The version the dialog has already opened itself for; `""` when there is none. */
  noticed: string;
  checkAtStart: boolean;

  /** Reads the running version and, with the preference on, checks once at launch. */
  start(): Promise<void>;
  /** Asks the endpoint what it offers; a manual check reports itself in the dialog either way. */
  check(manual: boolean): Promise<void>;
  showDialog(): void;
  dismissDialog(): void;
  /** Takes this version off the badge for good. */
  skip(): void;
  /** Downloads the update and hands over to it; the app does not come back from this. */
  install(): Promise<void>;
  openReleases(): Promise<void>;
  setCheckAtStart(on: boolean): void;
}

/** True when there is an update to shout about: one was found, and the user has not skipped it. */
export const updateReady = (s: UpdateState) =>
  s.status === "available" && s.update !== null && s.update.version !== s.skipped;

const SKIPPED = prefField(PREF_KEYS.skippedUpdate, "", isString);
const NOTICED = prefField(PREF_KEYS.noticedUpdate, "", isString);
const CHECK_AT_START = prefField(PREF_KEYS.checkAtStart, true, isBoolean);

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  update: null,
  releasesUrl: ipc.RELEASES_URL,
  progress: null,
  error: null,
  dialog: false,
  skipped: SKIPPED.read(),
  noticed: NOTICED.read(),
  checkAtStart: CHECK_AT_START.read(),

  async start() {
    // A dev build is served by Vite and has no bundle to replace, so there is nothing to offer.
    if (import.meta.env.DEV) return;
    try {
      set({ version: await ipc.appVersion() });
    } catch {
      // The menu can read "version unknown"; a check answers with the running version anyway.
    }
    if (get().checkAtStart) await get().check(false);
  },

  async check(manual) {
    set({ status: "checking", error: null });
    try {
      const result = await ipc.checkForUpdate();
      const found = result.update;
      // A version a check finds by itself is worth interrupting for once; after that the badge carries it.
      const notice =
        found !== null &&
        !manual &&
        found.version !== get().skipped &&
        found.version !== get().noticed
          ? found.version
          : null;
      if (notice !== null) NOTICED.save(notice);
      set({
        status: found === null ? "current" : "available",
        version: result.current,
        update: found,
        releasesUrl: result.releases_url,
        dialog: manual || notice !== null,
        noticed: notice ?? get().noticed,
      });
    } catch (e) {
      // Being offline is the normal reason a check fails, so only a check the user asked for says so.
      set({ status: "failed", error: errorMessage(e), dialog: manual });
    }
  },

  showDialog() {
    set({ dialog: true });
  },

  dismissDialog() {
    set({ dialog: false });
  },

  skip() {
    const { update } = get();
    if (update === null) return;
    SKIPPED.save(update.version);
    set({ skipped: update.version, dialog: false });
  },

  async install() {
    // Claimed before the confirm, so a second click while that dialog is up finds nothing to do.
    if (get().status !== "available") return;
    set({ status: "installing", progress: null, error: null });
    const session = useFileSessionStore.getState();
    // On Windows the installer ends this process from inside the command: a write in flight would
    // be cut mid-file, and the window's close hook never runs, so this is where discarding is asked.
    if (session.saving || !(await session.confirmDiscard())) {
      set({ status: "available" });
      return;
    }
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await onUpdateProgress((progress) => set({ progress }));
      await ipc.installUpdate();
    } catch (e) {
      // The backend keeps the update parked, so the dialog comes back with the error over a retry.
      set({ status: "available", error: errorMessage(e), dialog: true });
    } finally {
      unlisten?.();
    }
  },

  async openReleases() {
    try {
      await ipc.openUrl(get().releasesUrl);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  setCheckAtStart(on) {
    CHECK_AT_START.save(on);
    set({ checkAtStart: on });
  },
}));
