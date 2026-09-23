import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { DETAILS_DEBOUNCE_MS } from "../../../store/batching";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { planetSummary, systemDetails } from "../../../test/builders";
import { mocked, open, resetStores } from "../inspectorFixture";
import { SelectionView } from "./SelectionView";

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
    const systems = new Map(useGalaxyStore.getState().systems);
    systems.set(0, { ...systems.get(0)!, owner: 7 });
    useGalaxyStore.setState({ systems });
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

  function armStarClasses(): void {
    const star = (key: string, ...planet_keys: string[]) => ({
      key,
      texture_key: `star_class:${key}`,
      icon_scale: 1,
      planet_keys,
    });
    const bodies = Object.values(STARS).flat();
    useGameDataStore.setState({
      names: new Map([["sc_pulsar", "Pulsar"]]),
      starClasses: new Map(
        [
          star("sc_g", "pc_g_star"),
          star("sc_m", "pc_m_star"),
          star("sc_pulsar", "pc_pulsar"),
          star("sc_binary_1", "pc_a_star", "pc_pulsar"),
        ].map((c) => [c.key, c]),
      ),
      planetClasses: new Map(
        bodies.map((key) => [key, { key, icon_sprite: null, habitable: false, star: true }]),
      ),
    });
  }

  async function landChain(): Promise<void> {
    mocked.getSystemDetails.mockResolvedValue(
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

  it("offers a star class picker for a save selection once its details are read", async () => {
    armStarClasses();
    await open("save");
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    expect(renderToStaticMarkup(<SelectionView />)).toContain("Star class… (loading…)");

    await landChain();
    const html = renderToStaticMarkup(<SelectionView />);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Star class: Star class… (3 systems)"');
  });

  it("is not offered on a scenario", async () => {
    armStarClasses();
    await open("scenario");
    await useEditorStore.getState().setSelection(CHAIN, "replace");
    await landChain();
    const html = renderToStaticMarkup(<SelectionView />);
    expect(html).not.toContain("Star class");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });
});
