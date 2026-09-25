import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import { OPEN_RESULT, SCENARIO_RESULT, detailOf } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { mockedIpc } from "../test/ipc";
import { resizeBrush, resizeNebula, run } from "./commands";
import { session } from "./sessionFixture";
import { armSession, resetStores } from "./storeFixture";
import { PREF_KEYS } from "./prefKeys";
import {
  SPACING_RANGE,
  SPACING_SLIDER_MAX,
  sliderOfSpacing,
  spacingOfSlider,
  useToolStore,
  effectiveSpacing,
  MAX_SYSTEMS_PER_BRUSH,
  minSpacingFor,
} from "./toolStore";

const tools = () => useToolStore.getState();

const stored = new Map<string, string>();

const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

async function openScenario(): Promise<void> {
  mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
  await session().openSave(SCENARIO_RESULT.path);
}

beforeEach(() => {
  resetStores();
  stubPrefs(stored);
  armSession();
  mockedIpc.getSystem.mockImplementation(async (id) => detailOf(id));
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
    expect(tools().spacing).toBe(5);
    tools().setSpacing(200);
    expect(tools().spacing).toBe(150);
  });

  it("rounds spacing to one decimal place", () => {
    tools().setSpacing(12.34);
    expect(tools().spacing).toBe(12.3);
    tools().setSpacing(7.05);
    expect(tools().spacing).toBe(7.1);
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

describe("the symmetry toggle", () => {
  it("M turns on four-fold rotation before any symmetry has been picked, then off again", () => {
    expect(run("toggleSymmetry", false, effects)).toBe(true);
    expect(tools().symmetry).toEqual({ kind: "rotate", n: 4 });
    run("toggleSymmetry", false, effects);
    expect(tools().symmetry).toEqual({ kind: "off" });
  });

  it("M brings back the symmetry last picked, which persists", async () => {
    tools().setSymmetry({ kind: "mirror", axis: "y" });
    tools().toggleSymmetry();
    expect(tools().symmetry).toEqual({ kind: "off" });

    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore;
    expect(fresh.getState().symmetry).toEqual({ kind: "off" });
    fresh.getState().toggleSymmetry();
    expect(fresh.getState().symmetry).toEqual({ kind: "mirror", axis: "y" });
  });

  it("takes a stored symmetry from before the toggle as the one to bring back", async () => {
    stored.set(PREF_KEYS.symmetry, JSON.stringify({ kind: "rotate", n: 6 }));
    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore;
    fresh.getState().toggleSymmetry();
    fresh.getState().toggleSymmetry();
    expect(fresh.getState().symmetry).toEqual({ kind: "rotate", n: 6 });
  });
});

describe("symmetry on a save", () => {
  it("cannot be turned on, and M does nothing", async () => {
    await session().openSave(OPEN_RESULT.path);
    tools().setSymmetry({ kind: "rotate", n: 4 });
    expect(tools().symmetry).toEqual({ kind: "off" });
    expect(run("toggleSymmetry", false, effects)).toBe(false);
    expect(tools().symmetry).toEqual({ kind: "off" });
  });

  it("is dropped when a save opens with it still on", async () => {
    tools().setSymmetry({ kind: "mirror", axis: "y" });
    expect(tools().symmetry).toEqual({ kind: "mirror", axis: "y" });
    await session().openSave(OPEN_RESULT.path);
    expect(tools().symmetry).toEqual({ kind: "off" });
  });

  it("is turned off by opening a save without touching the preference, and kept by closing a scenario", async () => {
    await openScenario();
    tools().setSymmetry({ kind: "mirror", axis: "x" });
    const saved = stored.get(PREF_KEYS.symmetry);

    await session().openSave(OPEN_RESULT.path);
    expect(tools().symmetry).toEqual({ kind: "off" });
    expect(stored.get(PREF_KEYS.symmetry)).toBe(saved);
    expect(run("toggleSymmetry", false, effects)).toBe(false);
    expect(tools().symmetry).toEqual({ kind: "off" });

    await openScenario();
    tools().setSymmetry({ kind: "rotate", n: 3 });
    await session().close();
    expect(tools().symmetry).toEqual({ kind: "rotate", n: 3 });
  });

  it("is left alone on a scenario", async () => {
    await openScenario();
    tools().setSymmetry({ kind: "rotate", n: 6 });
    expect(tools().symmetry).toEqual({ kind: "rotate", n: 6 });
    expect(run("toggleSymmetry", false, effects)).toBe(true);
    expect(tools().symmetry).toEqual({ kind: "off" });
  });
});

describe("the least spacing a brush size allows", () => {
  it("leaves a small brush free and widens a large one's spacing so its circle holds at most the cap", () => {
    expect(minSpacingFor(40)).toBe(SPACING_RANGE.min);
    expect(minSpacingFor(400)).toBe(38.3);
    expect(effectiveSpacing(400, 10)).toBe(minSpacingFor(400));
    expect(effectiveSpacing(400, 60)).toBe(60);
    const fits = (0.7 * Math.PI * 200 * 200) / minSpacingFor(400) ** 2;
    expect(fits).toBeLessThanOrEqual(MAX_SYSTEMS_PER_BRUSH);
  });
});

describe("the density slider mapping", () => {
  it("maps the slider's endpoints to the spacing range's endpoints", () => {
    expect(spacingOfSlider(0)).toBe(150);
    expect(spacingOfSlider(SPACING_SLIDER_MAX)).toBe(5);
  });

  it("round-trips slider position through spacing, within its rounding", () => {
    for (const v of [0, 100, 250, 500, 750, 900, 1000]) {
      const spacing = spacingOfSlider(v);
      expect(spacing).toBeGreaterThanOrEqual(5);
      expect(spacing).toBeLessThanOrEqual(150);
      expect(Math.abs(sliderOfSpacing(spacing) - v)).toBeLessThanOrEqual(2);
    }
  });
});

describe("lane brush keys", () => {
  it("C and X pick the lane brushes on a save, and [ ] step their size", async () => {
    await session().openSave(OPEN_RESULT.path);
    expect(run("connectTool", false, effects)).toBe(true);
    expect(tools().tool).toBe("connect");
    expect(resizeBrush(1)).toBe(true);
    expect(tools().size).toBe(48);
    expect(run("cutTool", false, effects)).toBe(true);
    expect(tools().tool).toBe("cut");
    expect(resizeBrush(-1)).toBe(true);
    expect(tools().size).toBe(40);
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
