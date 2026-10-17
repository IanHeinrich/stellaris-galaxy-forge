import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { DETAILS_DEBOUNCE_MS } from "../../../store/batching";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { STARS_NEED_GAME_DATA } from "../../../lib/details/starClass";
import { planetSummary, systemDetails } from "../../../test/builders";
import { open, patchSystem, resetStores } from "../inspectorFixture";
import { armStarClasses } from "../../../store/storeFixture";
import { SelectionView } from "./SelectionView";
import { mockedIpc } from "../../../test/ipc";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("several systems selected", () => {
  /** Sol, Alpha Centauri and Barnard: a chain, so two lanes run between them and none is isolated. */
  const CHAIN = [0, 1, 2];

  async function selectChain(kind: "save" | "scenario"): Promise<string> {
    await open(kind);
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    return renderToStaticMarkup(<SelectionView />);
  }

  it("lists the bulk actions with their counts, and each chip removes its system", async () => {
    const html = await selectChain("scenario");
    expect(html).toContain("3 systems selected");
    expect(html).toContain("2 lanes between them · 0 owners · 0 isolated");
    expect(html).toContain("Connect to each other (1)");
    expect(html).toContain("Cut hyperlanes between (2)");
    expect(html).toContain("Isolate (3)");
    expect(html).toContain("Set initializer… (3 systems)");
    expect(html).toContain("Systems · 3");
    expect(html).toMatch(/title="Remove [^"]+ from the selection"/);
    expect(html).not.toContain("Filter the selection");
    expect(html).not.toContain("Jump to");
  });

  it("counts one lane and one owner in the singular", async () => {
    await selectChain("scenario");
    patchSystem(0, { owner: 7 });
    await useEditorStore.getState().setSelection([0, 1], "replace");
    expect(renderToStaticMarkup(<SelectionView />)).toContain("1 lane between them · 1 owner ·");
  });

  it("offers no initializer on a save, whose systems cannot take one", async () => {
    const html = await selectChain("save");
    expect(html).toContain("Isolate (3)");
    expect(html).toContain("Reset lane lengths");
    expect(html).not.toContain("Set initializer");
  });
});

describe("the bulk star class", () => {
  const CHAIN = [0, 1, 2];
  const STARS: Record<number, string[]> = {
    0: ["pc_g_star"],
    1: ["pc_a_star", "pc_pulsar"],
    2: ["pc_m_star"],
  };

  const CLASSES = {
    sc_g: ["pc_g_star"],
    sc_m: ["pc_m_star"],
    sc_pulsar: ["pc_pulsar"],
    sc_binary_1: ["pc_a_star", "pc_pulsar"],
  };

  async function landChain(): Promise<void> {
    mockedIpc.getSystemDetails.mockResolvedValue(
      CHAIN.map((id) =>
        systemDetails({
          id,
          with_game_data: true,
          planets: STARS[id].map((cls, i) => planetSummary({ id: id * 10 + i, class: cls })),
        }),
      ),
    );
    useDetailsStore.getState().request(CHAIN);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
  }

  it("offers a star class picker for a save selection without reading its details", async () => {
    armStarClasses(CLASSES, { sc_pulsar: "Pulsar" });
    await open("save");
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    mockedIpc.getSystemDetails.mockClear();

    const html = renderToStaticMarkup(<SelectionView />);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Star class: Star class… (3 systems)"');
    expect(mockedIpc.getSystemDetails).not.toHaveBeenCalled();
  });

  it("is not offered on a scenario", async () => {
    armStarClasses(CLASSES, { sc_pulsar: "Pulsar" });
    await open("scenario");
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    await landChain();
    const html = renderToStaticMarkup(<SelectionView />);
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });

  it("says a star edit needs game data while none is loaded", async () => {
    await open("save");
    useGameDataStore.setState({ status: "idle" });
    await useEditorStore.getState().setSelection(CHAIN, "replace");

    const html = renderToStaticMarkup(<SelectionView />);
    expect(html).toContain(`title="${STARS_NEED_GAME_DATA}"`);
  });
});

describe("the rotate section", () => {
  async function render(): Promise<string> {
    await open("scenario");
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    return renderToStaticMarkup(<SelectionView />);
  }

  it("offers an angle, the quarter and half turns and the nebulae choice", async () => {
    const html = await render();
    expect(html).toContain("Rotate");
    expect(html).toContain('aria-label="Degrees"');
    expect(html).toContain('value="45"');
    expect(html).toContain("90° left");
    expect(html).toContain("90° right");
    expect(html).toContain("180°");
    expect(html).toContain("Nebulae too");
    expect(html).not.toContain("Centre pivot");
  });

  it("shows the nebulae choice as the store holds it", async () => {
    await open("scenario");
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    useEditorStore.getState().setRotateNebulae(true);
    expect(renderToStaticMarkup(<SelectionView />)).toMatch(/type="checkbox" checked=""/);
  });

  it("offers to centre the pivot only once it has been moved", async () => {
    await open("scenario");
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    useEditorStore.getState().setRotatePivot({ x: 10, y: 20 });
    expect(renderToStaticMarkup(<SelectionView />)).toContain("Centre pivot");
  });
});
