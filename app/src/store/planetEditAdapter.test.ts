import type { PlanetPage } from "../generated/PlanetPage";
import { planetSummary } from "./fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { ModifierChoice } from "../generated/ModifierChoice";
import type { PlanetClassView } from "../generated/PlanetClassView";
import { modifierRows } from "../lib/details/planetPage";
import { mockedIpc } from "../test/ipc";
import { planetClassView, planetPage, starClassView } from "../test/builders";
import { openFixtureSave } from "./editorFixture";
import { editResult } from "./fixture";
import { heldAnomaly, planetEditAdapterFor, savePickerTarget } from "./planetEditAdapter";

/** Save body `page` in system 1, as its page hands it to the pickers. */
const pickerTarget = (page: PlanetPage) =>
  savePickerTarget(
    1,
    planetSummary({ id: page.id, class: page.class, size: page.size }),
    page,
    heldAnomaly(page),
  );

const BODY = { system: 4, id: 41 };
const save = () => planetEditAdapterFor("save", BODY);

/** Whether `edit` wrote, and the op it sent, if any. */
async function sent(edit: Promise<boolean>): Promise<[boolean, unknown]> {
  const wrote = await edit;
  const calls = mockedIpc.applyOp.mock.calls;
  return [wrote, calls.length === 0 ? null : calls[calls.length - 1][0]];
}

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.applyOp.mockClear();
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("a save body's fields", () => {
  it("renames to the trimmed text, and not to nothing or the same name", async () => {
    expect(await sent(save().rename("  Nova Terra ", "Olbers II"))).toEqual([
      true,
      { type: "RenameBody", body: 41, name: { Literal: "Nova Terra" } },
    ]);
    mockedIpc.applyOp.mockClear();
    expect(await save().rename("   ", "Olbers II")).toBe(false);
    expect(await save().rename("Olbers II", "Olbers II")).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("sets a whole size of at least 1, and refuses a range, a fraction or the same size", async () => {
    expect(save().ranges).toBe(false);
    expect(await sent(save().setSize({ min: 35, max: 35 }, 20))).toEqual([
      true,
      { type: "SetBodySize", body: 41, size: 35 },
    ]);
    expect((await sent(save().setSize({ min: 1, max: 1 }, 20)))[1]).toEqual({
      type: "SetBodySize",
      body: 41,
      size: 1,
    });
    mockedIpc.applyOp.mockClear();
    for (const size of [20, 0, -3, 2.5]) {
      expect(await save().setSize({ min: size, max: size }, 20)).toBe(false);
    }
    expect(await save().setSize({ min: 10, max: 20 }, 5)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("sends both classes' rules, and nothing for the class it has or one unknown", async () => {
    const classes = new Map<string, PlanetClassView>(
      [
        planetClassView("pc_ocean", false, null, { change: "any", models: 3 }),
        planetClassView("pc_barren", false, null, { habitable: false, models: 3 }),
      ].map((c) => [c.key, c]),
    );
    expect(await sent(save().setClass("pc_ocean", "pc_barren", classes))).toEqual([
      true,
      {
        type: "SetBodyClass",
        body: 41,
        from: { class: "pc_barren", change: "uncolonised", models: 3 },
        to: { class: "pc_ocean", change: "any", models: 3 },
      },
    ]);
    mockedIpc.applyOp.mockClear();
    expect(await save().setClass("pc_barren", "pc_barren", classes)).toBe(false);
    expect(await save().setClass("pc_unknown", "pc_barren", classes)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("gives a model, takes its own off with Default, and sends nothing unchanged", async () => {
    expect((await sent(save().setModel("pm_x", null)))[1]).toEqual({
      type: "SetBodyModel",
      body: 41,
      entity: "pm_x",
    });
    expect((await sent(save().setModel("", "pm_x")))[1]).toEqual({
      type: "SetBodyModel",
      body: 41,
      entity: null,
    });
    mockedIpc.applyOp.mockClear();
    expect(await save().setModel("", null)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("a save star's type", () => {
  const CLASSES = new Map(
    [
      starClassView("sc_g", "pc_g_star"),
      starClassView("sc_black_hole", "pc_black_hole"),
      starClassView("sc_binary_2", "pc_b_star", "pc_neutron_star"),
    ].map((c) => [c.key, c]),
  );
  const pair = [
    { id: 41, class: "pc_b_star" },
    { id: 42, class: "pc_neutron_star" },
  ];
  const binary = { id: 4, star_class: "sc_binary_2", bodies: pair };

  it("changes the one body and keeps the class when no class has the stars it leaves", async () => {
    expect((await sent(save().setStarType("pc_g_star", binary, CLASSES)))[1]).toEqual({
      type: "SetStarClass",
      system: 4,
      class: "sc_binary_2",
      bodies: [{ body: 41, class: "pc_g_star" }],
    });
  });

  it("moves the system to the class whose stars the bodies now are", async () => {
    const single = { id: 7, star_class: "sc_g", bodies: [{ id: 41, class: "pc_g_star" }] };
    expect((await sent(save().setStarType("pc_black_hole", single, CLASSES)))[1]).toMatchObject({
      class: "sc_black_hole",
      bodies: [{ body: 41, class: "pc_black_hole" }],
    });
    const mixed = {
      ...binary,
      bodies: [
        { id: 41, class: "pc_g_star" },
        { id: 42, class: "pc_neutron_star" },
      ],
    };
    expect((await sent(save().setStarType("pc_b_star", mixed, CLASSES)))[1]).toMatchObject({
      class: "sc_binary_2",
    });
  });

  it("prefers a class a new galaxy rolls over a variant with the same stars", async () => {
    const variant = { ...starClassView("sc_crisis_hole", "pc_black_hole"), spawn_odds: 0 };
    const classes = new Map([[variant.key, variant], ...CLASSES]);
    const single = { id: 7, star_class: "sc_g", bodies: [{ id: 41, class: "pc_g_star" }] };
    expect((await sent(save().setStarType("pc_black_hole", single, classes)))[1]).toMatchObject({
      class: "sc_black_hole",
    });
  });
});

describe("a save body's rows", () => {
  const choice = (modifier: string, name: string, feature: string | null): ModifierChoice => ({
    modifier,
    feature,
    category: feature === null ? "Positive" : "Feature",
    description: null,
    view: {
      key: feature ?? modifier,
      name,
      static_modifier: modifier,
      icon: null,
      icon_frame: null,
      effects: [],
    },
  });
  const MINERAL_POOR = choice("mineral_poor", "Mineral Poor", "pm_mineral_poor");
  const HOLY_WORLD = choice("holy_planet", "Holy World", null);

  it("adds a feature with its line, for ever unless days are set", async () => {
    expect((await sent(save().addModifier(MINERAL_POOR, null)))[1]).toEqual({
      type: "AddBodyModifier",
      body: 41,
      modifier: "mineral_poor",
      days: [-1],
      feature: "pm_mineral_poor",
    });
    expect((await sent(save().addModifier(HOLY_WORLD, 360)))[1]).toEqual({
      type: "AddBodyModifier",
      body: 41,
      modifier: "holy_planet",
      days: [360],
    });
  });

  it("removes a page row: a feature by its line and its modifier, a timed one by its name", async () => {
    const page = planetPage({
      id: 7,
      planet_modifiers: ["pm_mineral_poor"],
      timed_modifiers: [
        { modifier: "mineral_poor", days: -1 },
        { modifier: "holy_planet", days: 120 },
      ],
    });
    const [feature, timed] = modifierRows(page, new Map([["pm_mineral_poor", MINERAL_POOR.view]]));
    const { edits } = pickerTarget(page);
    expect((await sent(edits.removeModifier(feature)))[1]).toEqual({
      type: "RemoveBodyModifier",
      body: 7,
      modifier: "mineral_poor",
      feature: "pm_mineral_poor",
    });
    expect((await sent(edits.removeModifier(timed)))[1]).toEqual({
      type: "RemoveBodyModifier",
      body: 7,
      modifier: "holy_planet",
    });
  });

  it("removes the deposit its row gives back", async () => {
    const page = planetPage({
      id: 7,
      deposits: [{ id: 3, kind: "d_minerals_2", swap_type: null }],
    });
    const { edits } = pickerTarget(page);
    expect((await sent(edits.removeDeposit(page.deposits[0])))[1]).toEqual({
      type: "RemoveDeposit",
      deposit: 3,
    });
  });
});

describe("the adapter a document's kind picks", () => {
  it("writes nothing for a scenario's body or with no document", async () => {
    for (const edits of [
      planetEditAdapterFor("scenario", BODY),
      planetEditAdapterFor(null, BODY),
    ]) {
      expect(await edits.rename("Nova", "Olbers")).toBe(false);
      expect(await edits.setRing(true)).toBe(false);
      expect(await edits.remove("Olbers", false)).toBe(false);
    }
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
