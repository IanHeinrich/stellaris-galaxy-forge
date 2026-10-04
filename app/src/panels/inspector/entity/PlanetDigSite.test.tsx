import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { editResult } from "../../../store/fixture";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useDigSitePickerStore } from "../../../store/digSitePickerStore";
import { open, resetStores } from "../inspectorFixture";
import { PICKER_HEIGHT } from "./PickerMenu";
import { drawnBy, drawnButton } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { WORLD, pickerTarget, landPage, render, OLBERS } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a planet's dig site", () => {
  const SITE_TYPES = [
    {
      key: "site_lost_moments",
      name: "Never Forget",
      description: "Records of a people who chose to remember.",
      difficulty: 1,
      stages: 3,
      rolled: true,
      offered: true,
    },
    {
      key: "site_repowered_complex",
      name: "Repowered Complex",
      description: "A complex that has come back to life.",
      difficulty: 2,
      stages: 1,
      rolled: false,
      offered: true,
    },
  ];

  it("shows its dig site's stage, clues and description, with a button to remove it", async () => {
    await open("save");
    await landPage({
      ...OLBERS,
      dig_site: {
        id: 7,
        kind: "site_lost_moments",
        stages_done: 1,
        clues: 5,
        excavating: true,
      },
    });
    useGameDataStore.setState({ names: new Map([["site_lost_moments", "Never Forget"]]) });
    usePlanetDataStore.setState({ digSites: new Map(SITE_TYPES.map((t) => [t.key, t])) });

    const html = drawnBy(() => render(WORLD));
    expect(html).toContain("Dig site");
    expect(html).toContain("Never Forget");
    expect(html).toContain("Stage 2 of 3 · 5 clues · Excavating");
    expect(html).toContain('<span class="l3">Records of a people who chose to remember.</span>');
    expect(html).not.toContain("+ Add dig site…");
    expect(html.indexOf("Modifiers · 1")).toBeLessThan(html.indexOf("Dig site"));

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove Never Forget").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({ type: "RemoveDigSite", site: 7 }),
    );
  });

  it("counts the stages of a site type the picker leaves out", async () => {
    await open("save");
    await landPage({
      ...OLBERS,
      dig_site: { id: 2, kind: "site_the_library", stages_done: 3, clues: 0, excavating: false },
    });
    const library = {
      key: "site_the_library",
      name: "The Library",
      description: null,
      difficulty: 4,
      stages: 3,
      rolled: true,
      offered: false,
    };
    usePlanetDataStore.setState({ digSites: new Map([[library.key, library]]) });

    const html = render(WORLD);
    expect(html).toContain("Finished · 0 clues");
    expect(html).not.toContain('class="l3"');
  });

  it("describes nothing of its dig site without the game data", async () => {
    await open("save");
    await landPage({
      ...OLBERS,
      dig_site: { id: 7, kind: "site_lost_moments", stages_done: 0, clues: 0, excavating: false },
    });

    const html = render(WORLD);
    expect(html).toContain("Stage 1 · 0 clues");
    expect(html).not.toContain('class="l3"');
  });

  it("offers Add dig site without one, and the open picker filters by how a site is found", async () => {
    await open("save");
    await landPage(OLBERS);
    expect(render(WORLD)).toContain("+ Add dig site…");

    useDigSitePickerStore.setState({
      target: pickerTarget(OLBERS),
      choices: { body: "", list: SITE_TYPES },
      chip: "Events",
    });
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain('aria-label="Search dig sites"');
    expect(html).toContain(`<div class="dp" style="height:${PICKER_HEIGHT}px"`);
    expect(html).toContain("Found by surveys");
    expect(html).toContain('aria-pressed="true">Event only</button>');
    expect(html).toContain("Repowered Complex");
    expect(html).toContain("1 stage · event only");
    expect(html).not.toContain("Never Forget");
    expect(html).toMatch(
      /<div id="(ds-row-[^"]+-details)" class="dp-details"><span class="dp-details-name">Repowered Complex<\/span><span class="dp-details-text">A complex that has come back to life.<\/span><\/div>/,
    );
    expect(html).toMatch(
      /id="ds-row-[^"]+-0" class="dp-row active" aria-describedby="ds-row-[^"]+-details"/,
    );

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Add Repowered Complex").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "AddDigSite",
        body: WORLD,
        site_type: "site_repowered_complex",
        difficulty: 2,
      }),
    );

    useDigSitePickerStore.setState({
      target: pickerTarget(OLBERS),
      query: "no such site",
    });
    const none = render(WORLD);
    expect(none).toContain("No dig site matches");
    expect(none).toMatch(/class="dp-details"><\/div>/);
  });
});
