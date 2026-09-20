import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");

import * as ipc from "../api/ipc";
import { SYSTEM_SCRIPTS, TERRITORY } from "./fixture";
import { useScriptsStore } from "./scriptsStore";

const getSystemScripts = vi.mocked(ipc.getSystemScripts);

beforeEach(() => {
  vi.clearAllMocks();
  useScriptsStore.getState().clear();
  getSystemScripts.mockResolvedValue(SYSTEM_SCRIPTS);
});

describe("scriptsStore", () => {
  it("reads one system once and keeps the answer as the backend wrote it", async () => {
    const before = useScriptsStore.getState().version;

    useScriptsStore.getState().request(1);
    useScriptsStore.getState().request(1);
    expect(useScriptsStore.getState().pending.has(1)).toBe(true);

    await vi.waitFor(() => expect(useScriptsStore.getState().scripts.has(1)).toBe(true));
    const state = useScriptsStore.getState();
    expect(getSystemScripts).toHaveBeenCalledTimes(1);
    expect(getSystemScripts).toHaveBeenCalledWith(1);
    expect(state.version).toBe(before + 1);
    expect(state.pending.size).toBe(0);
    expect(state.scripts.get(1)).toBe(SYSTEM_SCRIPTS);
    expect(state.scripts.get(1)?.owner?.territory).toBe(TERRITORY.id);

    useScriptsStore.getState().request(1);
    expect(getSystemScripts).toHaveBeenCalledTimes(1);
  });

  it("asks once for a system the backend has no scripts for, and says so", async () => {
    getSystemScripts.mockResolvedValue(null);
    useScriptsStore.getState().request(2);

    await vi.waitFor(() => expect(useScriptsStore.getState().missing.has(2)).toBe(true));
    expect(useScriptsStore.getState().pending.size).toBe(0);
    expect(useScriptsStore.getState().scripts.has(2)).toBe(false);
    expect(useScriptsStore.getState().failed.has(2)).toBe(false);

    useScriptsStore.getState().request(2);
    expect(getSystemScripts).toHaveBeenCalledTimes(1);
  });

  it("keeps the message a failed reading gave and does not ask again on its own", async () => {
    getSystemScripts.mockRejectedValue({ kind: "game_data", message: "no game data is loaded" });
    useScriptsStore.getState().request(1);

    await vi.waitFor(() =>
      expect(useScriptsStore.getState().failed.get(1)).toBe("no game data is loaded"),
    );
    expect(useScriptsStore.getState().pending.size).toBe(0);
    expect(useScriptsStore.getState().missing.has(1)).toBe(false);

    // Its own version bump must not send it round again.
    useScriptsStore.getState().request(1);
    expect(getSystemScripts).toHaveBeenCalledTimes(1);

    getSystemScripts.mockResolvedValue(SYSTEM_SCRIPTS);
    useScriptsStore.getState().invalidate([1]);
    expect(useScriptsStore.getState().failed.has(1)).toBe(false);

    useScriptsStore.getState().request(1);
    await vi.waitFor(() => expect(useScriptsStore.getState().scripts.has(1)).toBe(true));
    expect(getSystemScripts).toHaveBeenCalledTimes(2);
  });

  it("invalidate drops what an edit touched and leaves the rest, bumping the version once", async () => {
    useScriptsStore.getState().request(1);
    await vi.waitFor(() => expect(useScriptsStore.getState().scripts.has(1)).toBe(true));
    const before = useScriptsStore.getState().version;

    useScriptsStore.getState().invalidate([4, 5]);
    expect(useScriptsStore.getState().version).toBe(before);

    useScriptsStore.getState().invalidate([1]);
    expect(useScriptsStore.getState().scripts.has(1)).toBe(false);
    expect(useScriptsStore.getState().version).toBe(before + 1);

    useScriptsStore.getState().request(1);
    await vi.waitFor(() => expect(getSystemScripts).toHaveBeenCalledTimes(2));
  });

  it("drops the cache on a clear and throws away what the old game data was answering", async () => {
    useScriptsStore.getState().request(1);
    useScriptsStore.getState().clear();

    await vi.waitFor(() => expect(getSystemScripts).toHaveBeenCalledTimes(1));
    expect(useScriptsStore.getState().scripts.size).toBe(0);
    expect(useScriptsStore.getState().pending.size).toBe(0);

    useScriptsStore.getState().request(1);
    await vi.waitFor(() => expect(useScriptsStore.getState().scripts.has(1)).toBe(true));
    expect(getSystemScripts).toHaveBeenCalledTimes(2);
  });
});
