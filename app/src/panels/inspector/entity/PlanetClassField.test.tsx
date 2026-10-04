import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { PlanetPage } from "../../../generated/PlanetPage";
import { bindStores } from "../../../store/bindStores";
import { planetClassView, editResult, planetPage } from "../../../store/fixture";
import { useGameDataStore } from "../../../store/gameDataStore";
import { land, open, resetStores } from "../inspectorFixture";
import { escaped as escapedText } from "../../../test/elements";
import { drawnBy, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { PickerField } from "../../EditField";
import { MODEL_TITLE } from "../../../lib/details/planetModel";
import { CLASS_FIXED, CLASS_LOOK_NOTE } from "../../../lib/details/planetClass";
import { STAR, WORLD, EMPIRE, armStarClasses, stars, landPage, render } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a planet's model", () => {
  const MODELS = [
    { entity: "ocean_paradise_planet_01_entity", label: "Ocean Paradise", classes: ["pc_ocean"] },
    { entity: "arctic_planet_earth_entity", label: "Earth", classes: ["pc_arctic"] },
  ];
  const MODEL = '<span class="edit-label">Model</span>';

  async function arm(over: Partial<PlanetPage> = {}): Promise<void> {
    await open("save");
    useGameDataStore.setState({
      planetModels: MODELS,
      names: new Map([["pc_arctic", "Arctic World"]]),
    });
    await landPage(planetPage({ id: WORLD, class: "pc_arctic", ...over }));
  }

  it("offers Default, then the class's usual models, then the others, and a pick sends it", async () => {
    await arm();
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain(MODEL);
    expect(html).toContain(escapedText(MODEL_TITLE));
    const field = drawnField(PickerField, "Model");
    expect(field.current.label).toBe("Default");
    expect(field.items.map((item) => [item.label, item.group])).toEqual([
      ["Default", undefined],
      ["Earth", "Usual for Arctic World"],
      ["Ocean Paradise", "Other models"],
    ]);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    field.onPick("ocean_paradise_planet_01_entity");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyModel",
        body: WORLD,
        entity: "ocean_paradise_planet_01_entity",
      }),
    );
  });

  it("shows the model a planet has, and Default takes it off", async () => {
    await arm({ entity_name: "ocean_paradise_planet_01_entity" });
    drawnBy(() => render(WORLD));
    const field = drawnField(PickerField, "Model");
    expect(field.current.label).toBe("Ocean Paradise");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    field.onPick("");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyModel",
        body: WORLD,
        entity: null,
      }),
    );
  });

  it("offers no model to a star or on a scenario", async () => {
    armStarClasses();
    await open("save");
    await land(stars());
    await landPage(planetPage({ id: STAR, class: "pc_a_star", size: 30 }));
    expect(render(STAR)).toContain("Star type");
    expect(render(STAR)).not.toContain(MODEL);

    await open("scenario");
    await landPage(planetPage({ id: WORLD, class: "pc_arctic" }));
    expect(render(WORLD)).not.toContain(MODEL);
  });
});

describe("a planet's class", () => {
  const CLASS = '<span class="edit-label">Class</span>';

  async function arm(over: Partial<PlanetPage> = {}): Promise<void> {
    await open("save");
    useGameDataStore.setState({
      names: new Map([
        ["pc_arctic", "Arctic World"],
        ["pc_ocean", "Ocean World"],
        ["pc_barren", "Barren World"],
      ]),
      planetClasses: new Map(
        [
          planetClassView("pc_arctic", false, null, { change: "any", models: 3 }),
          planetClassView("pc_ocean", false, null, { change: "any", models: 3 }),
          planetClassView("pc_barren", false, null, { habitable: false, models: 3 }),
          planetClassView("pc_habitat", false, null, { change: "never" }),
        ].map((c) => [c.key, c]),
      ),
    });
    await landPage(planetPage({ id: WORLD, class: "pc_arctic", ...over }));
  }

  it("offers the classes the planet may take, says the look resets, and a pick sends it", async () => {
    await arm();
    const html = drawnBy(() => render(WORLD));
    expect(html).toContain(CLASS);
    expect(html).toContain(escapedText(CLASS_LOOK_NOTE));
    expect(html).not.toContain('<span class="k">Class</span>');
    const field = drawnField(PickerField, "Class");
    expect(field.current.label).toBe("Arctic World");
    expect(field.items.map((item) => [item.label, item.group])).toEqual([
      ["Ocean World", "Habitable"],
      ["Barren World", "Other"],
    ]);

    mockedIpc.applyOp.mockResolvedValue(editResult());
    field.onPick("pc_barren");
    await vi.waitFor(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetBodyClass",
        body: WORLD,
        from: { class: "pc_arctic", change: "any", models: 3 },
        to: { class: "pc_barren", change: "uncolonised", models: 3 },
      }),
    );
  });

  it("offers a colony only the classes open to colonies", async () => {
    const colony = {
      id: 29,
      colonised: "2200.01.01",
      final_designation: null,
      designation: null,
      pops: 100,
      species: [],
      districts: [],
      zones: [],
      buildings: [],
    };
    await arm({ owner: EMPIRE, controller: EMPIRE, colony });
    drawnBy(() => render(WORLD));
    const field = drawnField(PickerField, "Class");
    expect(field.items.map((item) => item.key)).toEqual(["pc_ocean"]);
  });

  it("keeps a habitat's class, and offers no class on a scenario", async () => {
    await arm({ class: "pc_habitat" });
    drawnBy(() => render(WORLD));
    const field = drawnField(PickerField, "Class");
    expect(field.items).toEqual([]);
    expect(render(WORLD)).toContain(escapedText(CLASS_FIXED));
    expect(render(WORLD)).not.toContain(escapedText(CLASS_LOOK_NOTE));

    await open("scenario");
    await landPage(planetPage({ id: WORLD, class: "pc_arctic" }));
    expect(render(WORLD)).not.toContain(CLASS);
  });
});
