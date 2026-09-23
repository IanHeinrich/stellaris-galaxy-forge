import { paintModView } from "../test/builders";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useFileSessionStore } from "./fileSessionStore";
import { useLayoutStore } from "./layoutStore";
import { PAINT_MOD_POLL_MS, usePaintModStore } from "./paintModStore";

const mocked = { paintMod: vi.mocked(ipc.paintMod), workshopLinks: vi.mocked(ipc.workshopLinks) };

const INSTALLED = paintModView();

const stored = new Map<string, string>();

bindStores();

/** The shell's answers so far. */
const asked = () => mocked.paintMod.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  stubPrefs(stored);
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Paint a Galaxy mod's status", () => {
  it("is unknown until the shell answers, then what it said", async () => {
    expect(usePaintModStore.getState().known).toBe(false);
    expect(usePaintModStore.getState().paintMod).toBeNull();

    mocked.paintMod.mockResolvedValueOnce(INSTALLED);
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState()).toMatchObject({ known: true, paintMod: INSTALLED });

    mocked.paintMod.mockResolvedValueOnce(null);
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState()).toMatchObject({ known: true, paintMod: null });
  });

  it("keeps the last answer when an ask fails", async () => {
    mocked.paintMod.mockResolvedValueOnce(INSTALLED);
    await usePaintModStore.getState().refresh();

    mocked.paintMod.mockRejectedValueOnce(new Error("launcher busy"));
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState()).toMatchObject({ known: true, paintMod: INSTALLED });

    usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
    mocked.paintMod.mockRejectedValueOnce(new Error("launcher busy"));
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState().known).toBe(false);
  });

  it("remembers that the mod is not for this user", () => {
    expect(usePaintModStore.getState().noticeDismissed).toBe(false);
    usePaintModStore.getState().dismissNotice();
    expect(usePaintModStore.getState().noticeDismissed).toBe(true);
    expect(stored.get("sgf.paint.noticeDismissed")).toBe("true");
  });

  it("the Paint a Galaxy choice starts on and is kept per machine", () => {
    expect(usePaintModStore.getState().paintChoice).toBe(true);
    usePaintModStore.getState().setPaintChoice(false);
    expect(usePaintModStore.getState().paintChoice).toBe(false);
    expect(stored.get("sgf.paint.profile")).toBe("false");
  });

  it("keeps the same answer object when the shell says the same again", async () => {
    mocked.paintMod.mockResolvedValueOnce(INSTALLED);
    await usePaintModStore.getState().refresh();
    const first = usePaintModStore.getState().paintMod;

    mocked.paintMod.mockResolvedValueOnce({ ...INSTALLED });
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState().paintMod).toBe(first);

    mocked.paintMod.mockResolvedValueOnce({ ...INSTALLED, enabled: false });
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState().paintMod).not.toBe(first);
    expect(usePaintModStore.getState().paintMod).toEqual({ ...INSTALLED, enabled: false });

    mocked.paintMod.mockResolvedValue(null);
    await usePaintModStore.getState().refresh();
    await usePaintModStore.getState().refresh();
    expect(usePaintModStore.getState()).toMatchObject({ known: true, paintMod: null });
  });

  it("keeps asking while the mod is missing, and takes each answer as it comes", async () => {
    vi.useFakeTimers();
    try {
      mocked.paintMod.mockResolvedValueOnce(null);
      const stop = usePaintModStore.getState().watch();
      await vi.advanceTimersByTimeAsync(0);
      expect(asked()).toBe(1);
      expect(usePaintModStore.getState().paintMod).toBeNull();

      mocked.paintMod.mockResolvedValueOnce({ ...INSTALLED, enabled: false });
      await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
      expect(asked()).toBe(2);
      expect(usePaintModStore.getState().paintMod).toEqual({ ...INSTALLED, enabled: false });

      mocked.paintMod.mockResolvedValueOnce(INSTALLED);
      await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
      expect(asked()).toBe(3);
      expect(usePaintModStore.getState().paintMod).toEqual(INSTALLED);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops asking when told to", async () => {
    vi.useFakeTimers();
    try {
      mocked.paintMod.mockResolvedValue(null);
      const stop = usePaintModStore.getState().watch();
      await vi.advanceTimersByTimeAsync(0);
      stop();
      await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 3);
      expect(mocked.paintMod).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("polled only while an answer could change the screen", () => {
    const scenarioOpen = (extra: Partial<ReturnType<typeof useFileSessionStore.getState>> = {}) =>
      useFileSessionStore.setState({ status: "ready", kind: "scenario", ...extra });

    it("not with nothing open, nor for a save", async () => {
      vi.useFakeTimers();
      try {
        mocked.paintMod.mockResolvedValue(null);
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 2);
        expect(asked()).toBe(0);

        useFileSessionStore.setState({ status: "ready", kind: "save" });
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 2);
        expect(asked()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("for a plain scenario until the notice is dismissed, and for one on the layer until the mod is enabled", async () => {
      vi.useFakeTimers();
      try {
        mocked.paintMod.mockResolvedValue(null);
        scenarioOpen();
        await vi.advanceTimersByTimeAsync(0);
        expect(asked()).toBe(1);
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
        expect(asked()).toBe(2);

        usePaintModStore.getState().dismissNotice();
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 2);
        expect(asked()).toBe(2);

        useFileSessionStore.setState({ paintChosen: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(asked()).toBe(3);

        mocked.paintMod.mockResolvedValue(INSTALLED);
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
        expect(asked()).toBe(4);
        expect(usePaintModStore.getState().paintMod).toEqual(INSTALLED);
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 2);
        expect(asked()).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("starts again when the mod is enabled no more, and stops when the scenario closes", async () => {
      vi.useFakeTimers();
      try {
        usePaintModStore.setState({ known: true, paintMod: INSTALLED });
        scenarioOpen({ paintChosen: true });
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
        expect(asked()).toBe(0);

        mocked.paintMod.mockResolvedValue({ ...INSTALLED, enabled: false });
        await usePaintModStore.getState().refresh();
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
        expect(asked()).toBe(3);

        useFileSessionStore.setState({ status: "empty", kind: null });
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 2);
        expect(asked()).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("while a Paint a Galaxy choice is ticked in the new scenario or export dialog", async () => {
      vi.useFakeTimers();
      try {
        mocked.paintMod.mockResolvedValue(null);
        usePaintModStore.setState({ paintChoice: false });
        useLayoutStore.getState().showScenarioDialog();
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS);
        expect(asked()).toBe(0);

        usePaintModStore.getState().setPaintChoice(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(asked()).toBe(1);

        useLayoutStore.getState().hideScenarioDialog();
        await vi.advanceTimersByTimeAsync(PAINT_MOD_POLL_MS * 2);
        expect(asked()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("the Workshop pages", () => {
  it("asks the shell for them once, the first time one is wanted", async () => {
    mocked.workshopLinks.mockResolvedValue({
      paint_a_galaxy: "https://example.test/pag",
      reserved_spawns: "https://example.test/reserved",
      local_cluster: "https://example.test/cluster",
    });

    expect(await usePaintModStore.getState().workshopLink("reserved_spawns")).toBe(
      "https://example.test/reserved",
    );
    expect(await usePaintModStore.getState().workshopLink("paint_a_galaxy")).toBe(
      "https://example.test/pag",
    );
    expect(mocked.workshopLinks).toHaveBeenCalledTimes(1);
  });
});
