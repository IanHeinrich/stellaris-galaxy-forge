import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");

import * as ipc from "../api/ipc";
import { usePaintModStore } from "./paintModStore";

const mocked = { paintMod: vi.mocked(ipc.paintMod) };

const INSTALLED = { scenarios_dir: "C:/mods/pag/map/setup_scenarios", enabled: true };

const stored = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
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
});
