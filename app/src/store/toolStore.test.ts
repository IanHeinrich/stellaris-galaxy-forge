import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_RESULT, SCENARIO_RESULT, detailOf } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { confirm } from "@tauri-apps/plugin-dialog";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { resizeBrush, resizeNebula, run } from "./commands";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { PREF_KEYS } from "./prefKeys";
import { useToolStore } from "./toolStore";

const tools = () => useToolStore.getState();
const session = () => useFileSessionStore.getState();

const stored = new Map<string, string>();

bindStores();

const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn(), confirmRemoveNebula: vi.fn() };

async function openScenario(): Promise<void> {
  vi.mocked(ipc.openSave).mockResolvedValueOnce(SCENARIO_RESULT);
  await session().openSave(SCENARIO_RESULT.path);
}

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useToolStore.setState({ ...useToolStore.getInitialState() });
  vi.mocked(onProgress).mockResolvedValue(() => undefined);
  vi.mocked(ipc.openSave).mockResolvedValue(OPEN_RESULT);
  vi.mocked(ipc.getSystem).mockImplementation(async (id) => detailOf(id));
  vi.mocked(ipc.closeSave).mockResolvedValue();
  vi.mocked(ipc.warmDetails).mockResolvedValue();
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(ipc.getSpecialSystems).mockResolvedValue({
    systems: [],
    counts: [],
    with_game_data: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tool", () => {
  it("starts on Select", () => {
    expect(tools().tool).toBe("select");
  });

  it("refuses paint and erase over a save, and takes the lane brushes", async () => {
    await session().openSave(OPEN_RESULT.path);
    expect(tools().setTool("paint")).toBe(false);
    expect(tools().setTool("erase")).toBe(false);
    expect(tools().tool).toBe("select");
    expect(tools().setTool("connect")).toBe(true);
    expect(tools().tool).toBe("connect");
  });

  it("refuses paint with nothing open", () => {
    expect(tools().setTool("paint")).toBe(false);
    expect(tools().tool).toBe("select");
  });

  it("takes paint over a scenario, and falls back to Select when a save opens after it", async () => {
    await openScenario();
    expect(tools().setTool("paint")).toBe(true);
    expect(tools().tool).toBe("paint");
    await session().openSave(OPEN_RESULT.path);
    expect(tools().tool).toBe("select");
  });

  it("falls back to Select when the document closes", async () => {
    await session().openSave(OPEN_RESULT.path);
    tools().setTool("cut");
    await session().close();
    expect(tools().tool).toBe("select");
  });

  it("V picks Select, and Esc with nothing else to drop returns to it", async () => {
    await openScenario();
    tools().setTool("erase");
    run("selectTool", false, effects);
    expect(tools().tool).toBe("select");
    tools().setTool("erase");
    run("clearSelection", false, effects);
    expect(tools().tool).toBe("select");
  });
});

describe("brush settings", () => {
  it("default to a 40-unit brush, 25-unit spacing, nearby lanes, systems, no specials, no symmetry", () => {
    expect(tools()).toMatchObject({
      size: 40,
      spacing: 25,
      laneMode: "nearby",
      eraseTarget: "systems",
      eraseSpecials: false,
      symmetry: { kind: "off" },
    });
  });

  it("clamp size and spacing to their ranges", () => {
    tools().setSize(1);
    expect(tools().size).toBe(5);
    tools().setSize(1000);
    expect(tools().size).toBe(400);
    tools().setSpacing(2);
    expect(tools().spacing).toBe(10);
    tools().setSpacing(200);
    expect(tools().spacing).toBe(80);
  });

  it("[ and ] step the size by a ratio, inside the range", () => {
    tools().stepSize(1);
    expect(tools().size).toBe(48);
    tools().stepSize(-1);
    expect(tools().size).toBe(40);
    tools().setSize(5);
    tools().stepSize(-1);
    expect(tools().size).toBe(5);
    tools().setSize(400);
    tools().stepSize(1);
    expect(tools().size).toBe(400);
  });

  it("persist, and a fresh store reads them back clamped", async () => {
    tools().setSize(120);
    tools().setSpacing(30);
    tools().setLaneMode("off");
    tools().setEraseTarget("lanes");
    tools().setEraseSpecials(true);
    tools().setSymmetry({ kind: "rotate", n: 6 });
    expect(JSON.parse(stored.get(PREF_KEYS.brushSize)!)).toBe(120);

    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore.getState();
    expect(fresh).toMatchObject({
      tool: "select",
      size: 120,
      spacing: 30,
      laneMode: "off",
      eraseTarget: "lanes",
      eraseSpecials: true,
      symmetry: { kind: "rotate", n: 6 },
    });

    stored.set(PREF_KEYS.brushSize, "9000");
    stored.set(PREF_KEYS.symmetry, JSON.stringify({ kind: "rotate", n: 5 }));
    stored.set(PREF_KEYS.brushLaneMode, JSON.stringify("sometimes"));
    vi.resetModules();
    const cleaned = (await import("./toolStore")).useToolStore.getState();
    expect(cleaned.size).toBe(400);
    expect(cleaned.symmetry).toEqual({ kind: "off" });
    expect(cleaned.laneMode).toBe("nearby");
  });
});

describe("brush keys", () => {
  it("B and E pick the brushes on a scenario, and [ ] step the brush rather than a nebula", async () => {
    expect(run("paintTool", false, effects)).toBe(false);
    await openScenario();
    expect(run("paintTool", false, effects)).toBe(true);
    expect(tools().tool).toBe("paint");
    expect(resizeBrush(5)).toBe(true);
    expect(tools().size).toBe(48);
    expect(run("eraseTool", false, effects)).toBe(true);
    expect(resizeBrush(-1)).toBe(true);
    expect(tools().size).toBe(40);
    run("selectTool", false, effects);
    expect(resizeBrush(1)).toBe(false);
    expect(resizeNebula(1)).toBe(false);
  });
});
