import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { modifierView, editResult } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { open, resetStores } from "../inspectorFixture";
import { drawnBy, drawnButton } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { WORLD, EMPIRE, EMPIRE_NODE, landPage, render, districts, OLBERS } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a planet's modifiers", () => {
  it("offers a remove button per modifier, taking a feature's line with it, and a picker to add one", async () => {
    await open("save");
    await landPage(OLBERS);

    const html = drawnBy(() => render(WORLD));
    expect(html.match(/class="pl-dep-remove pl-mod-remove"/g)).toHaveLength(1);
    expect(html).toContain("+ Add modifier…");
    expect(html).not.toContain("Terraforming candidate");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove pm_abundant_geothermal_activity").onClick();
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "RemoveBodyModifier",
        body: WORLD,
        modifier: "abundant_geothermal_activity",
        feature: "pm_abundant_geothermal_activity",
      }),
    );
  });

  it("reads a planet modifier with its timed twin as one permanent row", async () => {
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage(OLBERS);
    usePlanetDataStore.setState({
      modifiers: new Map(
        [
          modifierView("pm_abundant_geothermal_activity", {
            name: "Abundant Geothermal Activity",
            static_modifier: "abundant_geothermal_activity",
            effects: [districts("district_generator_max_add", 4, "Max Generator Districts")],
          }),
          modifierView("abundant_geothermal_activity", { name: "Abundant Geothermal Activity" }),
        ].map((v) => [v.key, v]),
      ),
    });

    const html = render(WORLD);
    expect(html).toContain("Modifiers · 1");
    expect(html).toContain("+4 Max Generator Districts · permanent");
    expect(html).toMatch(/Surveyed by<\/span>.*Ti Zru Conservers/);
  });
});
