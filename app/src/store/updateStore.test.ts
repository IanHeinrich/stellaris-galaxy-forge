import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import type { UpdateCheck } from "../generated/UpdateCheck";
import type { UpdateProgress } from "../generated/UpdateProgress";
import type { UpdateView } from "../generated/UpdateView";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { confirm } from "@tauri-apps/plugin-dialog";
import { onUpdateProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { readPref } from "./prefs";
import { updateReady, useUpdateStore } from "./updateStore";

const mocked = {
  checkForUpdate: vi.mocked(ipc.checkForUpdate),
  installUpdate: vi.mocked(ipc.installUpdate),
  appVersion: vi.mocked(ipc.appVersion),
  openUrl: vi.mocked(ipc.openUrl),
  onUpdateProgress: vi.mocked(onUpdateProgress),
  confirm: vi.mocked(confirm),
};

const RELEASES = "https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/latest";

const UPDATE: UpdateView = {
  version: "0.6.0",
  notes: "Lanes keep their length\nNebulae move with their systems",
  date: "2026-09-19T09:30:00Z",
  install: "app",
};

const OFFERED: UpdateCheck = { current: "0.5.1", update: UPDATE, releases_url: RELEASES };
const NONE: UpdateCheck = { current: "0.5.1", update: null, releases_url: RELEASES };

const update = () => useUpdateStore.getState();
const badge = () => updateReady(useUpdateStore.getState());

const stored = new Map<string, string>();

let progressHandler: ((p: UpdateProgress) => void) | null = null;
let unlisten: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  stubPrefs(stored);
  progressHandler = null;
  unlisten = vi.fn<() => void>();
  mocked.onUpdateProgress.mockImplementation(async (h) => {
    progressHandler = h;
    return unlisten;
  });
  mocked.confirm.mockResolvedValue(true);
  useUpdateStore.setState({ ...useUpdateStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a check nobody asked for", () => {
  it("says the running copy is current, with no dialog and no badge", async () => {
    mocked.checkForUpdate.mockResolvedValue(NONE);

    await update().check(false);

    expect(update().status).toBe("current");
    expect(update().version).toBe("0.5.1");
    expect(update().dialog).toBe(false);
    expect(badge()).toBe(false);
  });

  it("lights the badge for an update it finds, and opens the dialog the first time", async () => {
    mocked.checkForUpdate.mockResolvedValue(OFFERED);

    await update().check(false);

    expect(update().status).toBe("available");
    expect(update().update).toEqual(UPDATE);
    expect(update().releasesUrl).toBe(RELEASES);
    expect(update().dialog).toBe(true);
    expect(badge()).toBe(true);
    expect(update().noticed).toBe("0.6.0");
    expect(stored.get(PREF_KEYS.noticedUpdate)).toBe('"0.6.0"');
  });

  it("leaves the same version to the badge on a later launch", async () => {
    mocked.checkForUpdate.mockResolvedValue(OFFERED);
    useUpdateStore.setState({ noticed: "0.6.0" });

    await update().check(false);

    expect(update().dialog).toBe(false);
    expect(badge()).toBe(true);
  });

  it("opens itself again once a newer version comes along", async () => {
    mocked.checkForUpdate.mockResolvedValue({
      ...OFFERED,
      update: { ...UPDATE, version: "0.6.1" },
    });
    useUpdateStore.setState({ noticed: "0.6.0" });

    await update().check(false);

    expect(update().dialog).toBe(true);
    expect(update().noticed).toBe("0.6.1");
  });

  it("fails silently: offline is normal, so nothing opens", async () => {
    mocked.checkForUpdate.mockRejectedValueOnce({ kind: "io", message: "no route to host" });

    await update().check(false);

    expect(update().status).toBe("failed");
    expect(update().error).toBe("no route to host");
    expect(update().dialog).toBe(false);
    expect(badge()).toBe(false);
  });
});

describe("a version the user skipped", () => {
  it("keeps the badge dark and the dialog shut, and a later version lights it again", async () => {
    mocked.checkForUpdate.mockResolvedValue(OFFERED);
    useUpdateStore.setState({ skipped: "0.6.0" });

    await update().check(false);
    expect(badge()).toBe(false);
    expect(update().dialog).toBe(false);

    mocked.checkForUpdate.mockResolvedValue({
      ...OFFERED,
      update: { ...UPDATE, version: "0.6.1" },
    });
    await update().check(false);
    expect(badge()).toBe(true);
  });

  it("is remembered across launches, and closes the dialog as it goes", async () => {
    mocked.checkForUpdate.mockResolvedValue(OFFERED);
    await update().check(true);

    update().skip();

    expect(
      readPref<string>(PREF_KEYS.skippedUpdate, "", (v): v is string => typeof v === "string"),
    ).toBe("0.6.0");
    expect(update().dialog).toBe(false);
    expect(badge()).toBe(false);
  });
});

describe("a check the user asked for", () => {
  it("opens the dialog even when there is nothing to report", async () => {
    mocked.checkForUpdate.mockResolvedValue(NONE);

    await update().check(true);

    expect(update().status).toBe("current");
    expect(update().dialog).toBe(true);
  });

  it("opens the dialog on a failure, carrying the message the backend gave", async () => {
    mocked.checkForUpdate.mockRejectedValueOnce({ kind: "io", message: "endpoint 403" });

    await update().check(true);

    expect(update().status).toBe("failed");
    expect(update().error).toBe("endpoint 403");
    expect(update().dialog).toBe(true);
  });
});

describe("installing", () => {
  beforeEach(async () => {
    mocked.checkForUpdate.mockResolvedValue(OFFERED);
    await update().check(false);
  });

  it("downloads nothing when the unsaved changes are not to be discarded", async () => {
    useFileSessionStore.setState({ dirty: true });
    mocked.confirm.mockResolvedValueOnce(false);

    await update().install();

    expect(mocked.installUpdate).not.toHaveBeenCalled();
    expect(mocked.onUpdateProgress).not.toHaveBeenCalled();
    expect(update().status).toBe("available");
  });

  it("reports the download it drives, and lets go of the event once it is over", async () => {
    let settle: (() => void) | null = null;
    mocked.installUpdate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    const installing = update().install();
    await vi.waitFor(() => expect(progressHandler).not.toBeNull());
    expect(update().status).toBe("installing");

    progressHandler!({ downloaded: 512, total: 2048, done: false });
    expect(update().progress).toEqual({ downloaded: 512, total: 2048, done: false });

    settle!();
    await installing;

    expect(mocked.installUpdate).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("keeps the update on a failure, with the reason over the buttons that retry it", async () => {
    mocked.installUpdate.mockRejectedValueOnce({ kind: "io", message: "signature mismatch" });

    await update().install();

    expect(update().status).toBe("available");
    expect(update().update).toEqual(UPDATE);
    expect(update().error).toBe("signature mismatch");
    expect(update().dialog).toBe(true);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("downloads again when the user retries after a failure", async () => {
    mocked.installUpdate.mockRejectedValueOnce({ kind: "io", message: "connection reset" });
    await update().install();

    mocked.installUpdate.mockResolvedValueOnce();
    await update().install();

    expect(mocked.installUpdate).toHaveBeenCalledTimes(2);
    expect(update().error).toBeNull();
  });

  it("refuses while the open document is being written", async () => {
    useFileSessionStore.setState({ saving: true });

    await update().install();

    expect(mocked.installUpdate).not.toHaveBeenCalled();
    expect(update().status).toBe("available");
  });

  it("ignores a second click while the first is still asking about unsaved changes", async () => {
    useFileSessionStore.setState({ dirty: true });
    let answer: ((ok: boolean) => void) | null = null;
    mocked.confirm.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    );
    mocked.installUpdate.mockResolvedValueOnce();

    const first = update().install();
    await update().install();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);

    answer!(true);
    await first;
    expect(mocked.installUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("the releases page", () => {
  it("opens the URL the app ships with before any check has run", async () => {
    mocked.openUrl.mockResolvedValueOnce();

    await update().openReleases();

    expect(mocked.openUrl).toHaveBeenCalledWith(RELEASES);
  });

  it("opens the URL the check answered with", async () => {
    mocked.checkForUpdate.mockResolvedValue(OFFERED);
    mocked.openUrl.mockResolvedValueOnce();
    await update().check(false);

    await update().openReleases();

    expect(mocked.openUrl).toHaveBeenCalledWith(RELEASES);
  });
});

describe("the check at start", () => {
  it("does nothing at all in a dev build, which has no bundle to replace", async () => {
    vi.stubEnv("DEV", true);

    await update().start();

    expect(mocked.appVersion).not.toHaveBeenCalled();
    expect(mocked.checkForUpdate).not.toHaveBeenCalled();
  });

  it("reads the running version but asks nothing when the preference is off", async () => {
    vi.stubEnv("DEV", false);
    mocked.appVersion.mockResolvedValueOnce("0.5.1");
    useUpdateStore.setState({ checkAtStart: false });

    await update().start();

    expect(update().version).toBe("0.5.1");
    expect(mocked.checkForUpdate).not.toHaveBeenCalled();
  });

  it("checks once when the preference is on", async () => {
    vi.stubEnv("DEV", false);
    mocked.appVersion.mockResolvedValueOnce("0.5.1");
    mocked.checkForUpdate.mockResolvedValue(OFFERED);

    await update().start();

    expect(mocked.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(badge()).toBe(true);
  });

  it("carries on with an unknown version when the package will not say", async () => {
    vi.stubEnv("DEV", false);
    mocked.appVersion.mockRejectedValueOnce(new Error("no package info"));
    mocked.checkForUpdate.mockResolvedValue(NONE);

    await update().start();

    expect(update().version).toBe("0.5.1");
    expect(mocked.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("remembers the preference the menu sets", () => {
    update().setCheckAtStart(false);

    expect(update().checkAtStart).toBe(false);
    expect(stored.get(PREF_KEYS.checkAtStart)).toBe("false");
  });
});
