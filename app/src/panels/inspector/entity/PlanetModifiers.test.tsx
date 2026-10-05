import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { modifierView, editResult } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { open, resetStores } from "../inspectorFixture";
import { drawnBy, drawnButton, lastDrawn } from "../../../test/drawn";
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
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "RemoveBodyModifier",
      body: WORLD,
      modifier: "abundant_geothermal_activity",
      feature: "pm_abundant_geothermal_activity",
    });
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
    expect(html).toContain(
      '<span class="l2"><span>+4 Max Generator Districts</span> · permanent</span>',
    );
    expect(html).toMatch(/Surveyed by<\/span>.*Ti Zru Conservers/);
  });

  it("names a modifier's first two effects and how long it lasts, and keeps its remove button", async () => {
    await open("save");
    await landPage(OLBERS);
    usePlanetDataStore.setState({
      modifiers: new Map(
        [
          modifierView("pm_abundant_geothermal_activity", {
            name: "Abundant Geothermal Activity",
            static_modifier: "abundant_geothermal_activity",
            effects: [
              districts("district_generator_max_add", 20, "Max Agriculture Districts"),
              districts("planet_farmers_energy_produces_add", 4, "Energy Credits per 100 Farmers"),
              districts("planet_stability_add", 5, "Stability"),
            ],
          }),
        ].map((v) => [v.key, v]),
      ),
    });

    const html = drawnBy(() => render(WORLD));
    expect(html).toContain(
      '<span class="l2"><span>+20 Max Agriculture Districts, +4 Energy Credits per 100 Farmers' +
        '<span class="muted dp-more"> +1 more</span></span> · permanent</span>',
    );
    expect(html).not.toContain("dp-card");
    const card = lastDrawn(({ props }) => "shown" in props && "rowId" in props, "modifier card");
    expect(card.shown).toBe(false);
    expect(card.item).toEqual({
      label: "Abundant Geothermal Activity",
      effects: [
        "+20 Max Agriculture Districts",
        "+4 Energy Credits per 100 Farmers",
        "+5 Stability",
      ],
      note: "permanent",
    });

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove Abundant Geothermal Activity").onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "RemoveBodyModifier", body: WORLD }),
    );
  });
});
