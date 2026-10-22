import { planetSummary } from "./fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EditResult } from "../generated/EditResult";
import type { ModifierChoice } from "../generated/ModifierChoice";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { PlanetPage } from "../generated/PlanetPage";
import { modifierPickRows } from "../lib/details/modifierPicker";
import { modifierRows } from "../lib/details/planetPage";
import { mockedIpc } from "../test/ipc";
import { planetClassView, planetPage, starClassView } from "../test/builders";
import { modifierChoice } from "./fixtures/planet";
import { openFixtureSave } from "./editorFixture";
import { editResult } from "./fixture";
import { documentCapabilities } from "../lib/capabilities";
import { selectedBody } from "../lib/details/bodiesEdit";
import { useFileSessionStore } from "./fileSessionStore";
import { useModifierPickerStore } from "./modifierPickerStore";
import { bodiesEdits, planetEditAdapterFor } from "./planetEditAdapter";
import { pickerTarget } from "../test/pickerTarget";

const BODY = { system: 4, id: 41 };
const save = () => planetEditAdapterFor("save", BODY);

/** Whether `edit` wrote, and the op it sent, if any. */
async function sent(edit: Promise<boolean>): Promise<[boolean, unknown]> {
  const wrote = await edit;
  const calls = mockedIpc.applyOp.mock.calls;
  return [wrote, calls.length === 0 ? null : calls[calls.length - 1][0]];
}

/** A mod's asteroid industry candidate: the game sets a flag all of them share, and its own. */
const candidate = (kind: string) =>
  modifierChoice(`giga_asteroid_industry_candidate_${kind}`, `${kind} candidate`, {
    flags: ["giga_asteroid_industry_candidate", `giga_asteroid_industry_candidate_${kind}`],
  });
const ALLOYS = candidate("alloys");
const GOODS = candidate("consumer_goods");
const SHARED_FLAG = { flag: "giga_asteroid_industry_candidate" };
const flagOf = (choice: ModifierChoice) => ({ flag: choice.flags[1] });

/** Save body `id` holding `choices` for ever, as its page reads it. */
const holding = (id: number, ...choices: ModifierChoice[]) =>
  planetPage({ id, timed_modifiers: choices.map((c) => ({ modifier: c.modifier, days: -1 })) });

/** The session answers a read of each of `pages` with it. */
function reads(...pages: PlanetPage[]): void {
  mockedIpc.getPlanetPage.mockImplementation(async (id) => {
    const page = pages.find((p) => p.id === id);
    if (page === undefined) throw new Error(`planet #${id} not found`);
    return page;
  });
}

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.applyOp.mockClear();
  mockedIpc.applyOp.mockResolvedValue(editResult());
  mockedIpc.getModifierChoices.mockReset();
  mockedIpc.getModifierChoices.mockResolvedValue([ALLOYS, GOODS]);
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
  const MINERAL_POOR = modifierChoice("mineral_poor", "Mineral Poor", {
    feature: "pm_mineral_poor",
  });
  const HOLY_WORLD = modifierChoice("holy_planet", "Holy World");

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

  it("adds a modifier with the planet flags the game sets with it", async () => {
    expect((await sent(save().addModifier(ALLOYS, null)))[1]).toEqual({
      type: "AddBodyModifier",
      body: 41,
      modifier: ALLOYS.modifier,
      days: [-1],
      flags: [SHARED_FLAG, flagOf(ALLOYS)],
    });
  });

  it("takes off with a modifier its flags that no modifier the planet keeps sets too", async () => {
    const both = holding(7, ALLOYS, GOODS);
    reads(both);
    const [, goods] = modifierRows(both, new Map());
    expect((await sent(pickerTarget(both).edits.removeModifier(goods)))[1]).toEqual({
      type: "RemoveBodyModifier",
      body: 7,
      modifier: GOODS.modifier,
      flags: [flagOf(GOODS)],
    });
    const last = holding(7, ALLOYS);
    reads(last);
    const [alloys] = modifierRows(last, new Map());
    expect((await sent(pickerTarget(last).edits.removeModifier(alloys)))[1]).toEqual({
      type: "RemoveBodyModifier",
      body: 7,
      modifier: ALLOYS.modifier,
      flags: [SHARED_FLAG, flagOf(ALLOYS)],
    });
  });

  it("reads what the planet holds once the edits queued before a removal have landed", async () => {
    const before = holding(7, ALLOYS);
    const target = pickerTarget(before);
    let landed = false;
    mockedIpc.getPlanetPage.mockImplementation(async () =>
      landed ? holding(7, ALLOYS, GOODS) : before,
    );
    let land!: (result: EditResult) => void;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));

    useModifierPickerStore.getState().openOn(target);
    const [goods] = modifierPickRows([GOODS], target.modifiers, null, () => "");
    const adding = useModifierPickerStore.getState().add(goods);
    const removing = target.edits.removeModifier(modifierRows(before, new Map())[0]);
    landed = true;
    land(editResult());
    await adding;

    expect((await sent(removing))[1]).toEqual({
      type: "RemoveBodyModifier",
      body: 7,
      modifier: ALLOYS.modifier,
      flags: [flagOf(ALLOYS)],
    });
  });

  it("reads the choices once per game data, sharing the picker's read", async () => {
    const page = holding(7, ALLOYS);
    reads(page);
    const target = pickerTarget(page);
    const [alloys] = modifierRows(page, new Map());
    await useModifierPickerStore.getState().load(target);
    expect(await target.edits.removeModifier(alloys)).toBe(true);
    expect(await target.edits.removeModifier(alloys)).toBe(true);
    expect(mockedIpc.getModifierChoices).toHaveBeenCalledTimes(1);
  });

  it("refuses a removal, and says why, when the choices can't be read", async () => {
    mockedIpc.getModifierChoices.mockRejectedValue(new Error("the game data is not loaded"));
    const page = holding(7, ALLOYS);
    reads(page);
    const target = pickerTarget(page);
    expect(await target.edits.removeModifier(modifierRows(page, new Map())[0])).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(useFileSessionStore.getState().error).toBe("the game data is not loaded");
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
    reads(page);
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

describe("several selected bodies' edits", () => {
  const NO_ROWS = {
    deposits: { features: [], blockers: [], addWarnings: () => [] },
    modifiers: [],
  };
  const FACTS = {
    planetClasses: new Map(),
    starClasses: new Map(),
    megastructures: new Set<number>(),
  };
  const bodies = [41, 42].map((id) =>
    selectedBody(
      {
        summary: planetSummary({ id, class: "pc_desert", size: 10 }),
        rows: NO_ROWS,
        held: { deposits: [], modifiers: [] },
      },
      `#${id}`,
      FACTS,
    ),
  );
  const several = (selected = bodies) =>
    bodiesEdits(
      {
        kind: "save",
        bodies: selected,
        system: 4,
        where: "Olbers",
        lock: { sending: false },
        depositName: (kind) => kind,
        className: (key) => key,
      },
      () => {},
    );

  it("send each body the op its own page sends, as one edit, while the document takes them", async () => {
    expect(await sent(several().setSize({ min: 12, max: 12 }, 10))).toEqual([
      true,
      {
        type: "Batch",
        description: "Set the size of 2 planets to 12 in Olbers",
        ops: [41, 42].map((body) => ({ type: "SetBodySize", body, size: 12 })),
      },
    ]);

    mockedIpc.applyOp.mockClear();
    useFileSessionStore.setState((s) => ({
      capabilities: { ...documentCapabilities(s), edit_bodies: false },
    }));
    expect(await several().setSize({ min: 14, max: 14 }, 10)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("adds and takes off a modifier's flags on each planet by the modifiers it keeps", async () => {
    reads(holding(41, ALLOYS, GOODS), holding(42, GOODS));
    const holder = (id: number, ...choices: ModifierChoice[]) => {
      const rows = modifierRows(holding(id, ...choices), new Map());
      return selectedBody(
        {
          summary: planetSummary({ id, class: "pc_desert", size: 10 }),
          rows: { ...NO_ROWS, modifiers: rows.map((row) => ({ row, ref: row })) },
          held: { deposits: [], modifiers: rows.map((row) => row.key) },
        },
        `#${id}`,
        FACTS,
      );
    };
    const pair = [holder(41, ALLOYS, GOODS), holder(42, GOODS)];
    const [alloys, goods] = pair[0].rows.modifiers.map(({ row }) => row);
    const opsOf = async (edit: Promise<boolean>) =>
      ((await sent(edit))[1] as { ops: unknown[] }).ops;

    expect(await opsOf(several(pair).removeModifier(goods))).toEqual([
      { type: "RemoveBodyModifier", body: 41, modifier: GOODS.modifier, flags: [flagOf(GOODS)] },
      {
        type: "RemoveBodyModifier",
        body: 42,
        modifier: GOODS.modifier,
        flags: [SHARED_FLAG, flagOf(GOODS)],
      },
    ]);
    const added = {
      type: "AddBodyModifier",
      body: 42,
      modifier: ALLOYS.modifier,
      days: [-1],
      flags: [SHARED_FLAG, flagOf(ALLOYS)],
    };
    expect(await opsOf(several(pair).addModifier(ALLOYS, null))).toEqual([added]);
    expect(await opsOf(several(pair).fillModifier(alloys))).toEqual([added]);
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
