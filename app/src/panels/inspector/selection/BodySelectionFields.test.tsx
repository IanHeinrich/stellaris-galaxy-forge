import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { Op } from "../../../generated/Op";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PickerTarget } from "../../../lib/details/picker";
import { modifierPickRows } from "../../../lib/details/modifierPicker";
import { bindStores } from "../../../store/bindStores";
import { useEntityStore } from "../../../store/entityStore";
import {
  depositTypeView,
  editResult,
  modifierView,
  planetClassView,
  planetPage,
  resourceAmount,
} from "../../../store/fixture";
import { systemLabelOf } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import type { Entry } from "../../../store/inspectorStore";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useSceneStore } from "../../../store/sceneStore";
import { drawnBy, drawnButton, drawnField, lastDrawn } from "../../../test/drawn";
import { escaped, shown } from "../../../test/elements";
import { mockedIpc } from "../../../test/ipc";
import { PickerField, TextField } from "../../EditField";
import { MODIFIER_PICKER } from "../entity/ModifierPicker";
import { PlanetPicker } from "../entity/PlanetPicker";
import { details, land, open, planet, resetStores, SYSTEM } from "../inspectorFixture";
import { BodySelectionView } from "./BodySelectionView";

bindStores();

const [STAR, DESERT, GIANT, MOON, FROZEN, STAR_B] = [10, 11, 12, 13, 14, 15];
const ENTRY: Entry = { ref: { kind: "bodies", system: SYSTEM }, label: "5 selected" };

/** Meissa: a B star, a desert colony, a ringed gas giant with its moon, and a frozen world. */
const SUMMARIES = [
  planet(STAR, "Meissa", { class: "pc_b_star", size: 30 }),
  planet(DESERT, "Meissa I", { class: "pc_desert", size: 12, colonised: true, owner: 7 }),
  planet(GIANT, "Meissa II", { class: "pc_gas_giant", size: 25, ring: true }),
  planet(MOON, "Meissa IIa", { class: "pc_barren", size: 6, moon: true, parent: GIANT }),
  planet(FROZEN, "Meissa III", { class: "pc_frozen", size: 15 }),
  planet(STAR_B, "Meissa B", { class: "pc_b_star", size: 20 }),
];

const PAGES: PlanetPage[] = [
  planetPage({ id: STAR, class: "pc_b_star" }),
  planetPage({
    id: DESERT,
    class: "pc_desert",
    deposits: [
      { id: 101, kind: "d_minerals_3", swap_type: null },
      { id: 102, kind: "d_dense_jungle", swap_type: null },
    ],
    timed_modifiers: [{ modifier: "hazardous_weather", days: -1 }],
  }),
  planetPage({ id: GIANT, class: "pc_gas_giant" }),
  planetPage({ id: MOON, class: "pc_barren", parent: GIANT }),
  planetPage({
    id: FROZEN,
    class: "pc_frozen",
    deposits: [{ id: 104, kind: "d_minerals_3", swap_type: null }],
    timed_modifiers: [{ modifier: "terraforming_candidate", days: -1 }],
  }),
  planetPage({ id: STAR_B, class: "pc_b_star" }),
];

const CLASSES = new Map(
  [
    planetClassView("pc_b_star"),
    planetClassView("pc_desert", false, null, { change: "any" }),
    planetClassView("pc_continental", false, null, { change: "any" }),
    planetClassView("pc_city", false, null, { change: "any", moonless: true }),
    planetClassView("pc_gas_giant", false, null, { habitable: false }),
    planetClassView("pc_barren", false, null, { habitable: false }),
    planetClassView("pc_frozen", false, null, { habitable: false }),
  ].map((c) => [c.key, c]),
);

const page = () => drawnBy(() => renderToStaticMarkup(<BodySelectionView entry={ENTRY} />));
const where = () => systemLabelOf(SYSTEM);
const sizeField = () => drawnField(TextField, "Size") as { onCommit(text: string): void };

/** The last op sent, which every action here sends as one Batch. */
function sent(): Extract<Op, { type: "Batch" }> {
  const op = mockedIpc.applyOp.mock.lastCall?.[0];
  if (op?.type !== "Batch") throw new Error(`expected a Batch, got ${op?.type}`);
  return op;
}

/** Reads every selected body's page, as the page asks for them again after an edit. */
async function readPages(): Promise<void> {
  for (const p of PAGES) useEntityStore.getState().requestPlanetPage(p.id);
  await vi.advanceTimersByTimeAsync(0);
}

async function select(...ids: number[]): Promise<void> {
  useSceneStore.getState().selectBody(SYSTEM, ids[0]);
  for (const id of ids.slice(1)) useSceneStore.getState().toggleBody(SYSTEM, id);
  await vi.advanceTimersByTimeAsync(0);
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
  await open("save");
  useSceneStore.getState().enterSystem(SYSTEM);
  useGameDataStore.setState({
    planetClasses: CLASSES,
    names: new Map([
      ["pc_continental", "Continental"],
      ["pc_desert", "Desert"],
    ]),
  });
  usePlanetDataStore.setState({
    depositTypes: new Map([
      [
        "d_minerals_3",
        depositTypeView("d_minerals_3", {
          name: "Minerals",
          yields: [resourceAmount("minerals", 3, "Minerals")],
        }),
      ],
      [
        "d_dense_jungle",
        depositTypeView("d_dense_jungle", { name: "Dense Jungle", blocker: true }),
      ],
    ]),
    modifiers: new Map([
      ["hazardous_weather", modifierView("hazardous_weather", { name: "Hazardous Weather" })],
      [
        "terraforming_candidate",
        modifierView("terraforming_candidate", { name: "Terraforming Candidate" }),
      ],
    ]),
  });
  await land(details({ planets: SUMMARIES }));
  mockedIpc.planetMoveTargets.mockImplementation(async (planets) => ({
    planets,
    refused: [],
    systems: [],
  }));
  mockedIpc.getPlanetPage.mockImplementation(async (id) => PAGES.find((p) => p.id === id)!);
  await readPages();
  mockedIpc.applyOp.mockResolvedValue(
    editResult({ touched_entities: PAGES.map((p) => ({ kind: "planet", id: p.id })) }),
  );
  await select(STAR, DESERT, GIANT, MOON, FROZEN);
});

describe("several selected bodies' size", () => {
  it("shows their range, and a typed size goes to every body with another size, the star too", async () => {
    const html = page();
    expect(html).toContain('placeholder="6–30 (mixed)"');
    sizeField().onCommit("15");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual({
      type: "Batch",
      description: `Set the size of 4 bodies to 15 in ${where()}`,
      ops: [STAR, DESERT, GIANT, MOON].map((body) => ({ type: "SetBodySize", body, size: 15 })),
    });
  });

  it("sends nothing for a size of 0", async () => {
    page();
    sizeField().onCommit("0");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("several selected bodies' class", () => {
  it("offers only the classes every planet may take, says why there are fewer, and skips the star", async () => {
    const html = page();
    const field = drawnField(PickerField, "Class");
    expect(field.current.label).toBe("Mixed (4 classes)");
    expect(field.items.map((item) => item.key)).toEqual(["pc_continental", "pc_desert"]);
    expect(shown(html)).toContain("⚠ Fewer classes: Meissa I is colonised. Meissa IIa is a moon.");
    expect(html).toContain(`title="${escaped("Meissa is a star")}">Skips the star.</div>`);

    field.onPick("pc_continental");
    await vi.advanceTimersByTimeAsync(0);
    const batch = sent();
    expect(batch.description).toBe(`Changed 4 planets to Continental in ${where()}`);
    expect(batch.ops.map((op) => op.type === "SetBodyClass" && [op.body, op.to.class])).toEqual([
      [DESERT, "pc_continental"],
      [GIANT, "pc_continental"],
      [MOON, "pc_continental"],
      [FROZEN, "pc_continental"],
    ]);
  });
});

describe("several selected bodies' ring", () => {
  it("is partly ticked, leaves out the star and the moon, and a click rings the rest", async () => {
    const html = page();
    expect(html).toContain("Ring · 1 of 3 has one");
    expect(html).toContain(">Skips the star and 1 moon.</div>");
    const box = lastDrawn(
      ({ type, props }) => type === "input" && props.type === "checkbox",
      "ring",
    ) as { onChange(e: unknown): void };
    box.onChange({ currentTarget: { checked: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual({
      type: "Batch",
      description: `Added a ring to 2 planets in ${where()}`,
      ops: [DESERT, FROZEN].map((body) => ({ type: "SetBodyRing", body, ring: true })),
    });
  });
});

describe("several selected bodies' deposits", () => {
  it("lists who has each type, and adds one to each body without it", async () => {
    const text = shown(page());
    expect(text).toContain("Deposits · 1 type · 1 blocker");
    expect(text).toContain("on 2 of 5 · Meissa I, Meissa III");
    expect(text).toContain("on 1 of 5 · Meissa I");

    drawnButton("Add one Dense Jungle to each body without one").onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual({
      type: "Batch",
      description: `Added Dense Jungle to 4 bodies in ${where()}`,
      ops: [STAR, GIANT, MOON, FROZEN].map((body) => ({
        type: "AddDeposit",
        body,
        kind: "d_dense_jungle",
      })),
    });
  });

  it("removes one from each body that has one, by its deposit id", async () => {
    page();
    drawnButton("Remove one Minerals from each body that has one").onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual({
      type: "Batch",
      description: `Removed Minerals from 2 planets in ${where()}`,
      ops: [
        { type: "RemoveDeposit", deposit: 101 },
        { type: "RemoveDeposit", deposit: 104 },
      ],
    });
  });
});

describe("several selected bodies' modifiers", () => {
  it("counts planets only, and adds or removes a row's modifier where it is missing or held", async () => {
    const text = shown(page());
    expect(text).toContain("Modifiers · 2");
    expect(text).toContain("on 1 of 4 · Meissa I");

    drawnButton("Add Hazardous Weather to each planet without it, for good").onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual({
      type: "Batch",
      description: `Added Hazardous Weather to 3 planets in ${where()}`,
      ops: [GIANT, MOON, FROZEN].map((body) => ({
        type: "AddBodyModifier",
        body,
        modifier: "hazardous_weather",
        days: [-1],
      })),
    });

    await readPages();
    page();
    drawnButton("Remove Hazardous Weather from each planet that has it").onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent().ops).toEqual([
      { type: "RemoveBodyModifier", body: DESERT, modifier: "hazardous_weather" },
    ]);
  });

  it("has the picker count the planets an add reaches, and add to those without it", async () => {
    page();
    const { target } = lastDrawn(
      ({ type, props }) => type === PlanetPicker && props.kind === MODIFIER_PICKER,
      "modifier picker",
    ) as { target: PickerTarget };
    const choice = {
      modifier: "terraforming_candidate",
      feature: null,
      category: "Terraforming" as const,
      description: null,
      view: modifierView("terraforming_candidate", { name: "Terraforming Candidate" }),
    };
    const [row] = modifierPickRows([choice], target.modifiers, null, () => "", target.spread);
    expect(row.lacking).toBe(3);

    useModifierPickerStore.getState().openOn(target);
    await useModifierPickerStore.getState().add(row);
    expect(sent()).toEqual({
      type: "Batch",
      description: `Added Terraforming Candidate to 3 planets in ${where()}`,
      ops: [DESERT, GIANT, MOON].map((body) => ({
        type: "AddBodyModifier",
        body,
        modifier: "terraforming_candidate",
        days: [-1],
      })),
    });
  });
});

describe("the fields two stars take", () => {
  it("shows Size and Deposits only", async () => {
    await select(STAR, STAR_B);
    const html = page();
    expect(html).toContain('aria-label="Size"');
    expect(shown(html)).toContain("Deposits");
    expect(html).not.toContain('aria-label="Class');
    expect(html).not.toContain("Ring ·");
    expect(html).not.toContain("Modifiers");
  });
});

describe("the fields while an edit is out", () => {
  const JUNGLE = "Add one Dense Jungle to each body without one";

  it("sends one edit for a double click, and none from the stale rows once it lands", async () => {
    page();
    const add = drawnButton(JUNGLE);
    add.onClick();
    add.onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(useEntityStore.getState().stalePages.size).toBeGreaterThan(0);

    expect(page()).toContain('<fieldset class="ins-fields" disabled="">');
    add.onClick();
    drawnButton(JUNGLE).onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  });
});

describe("a selected body whose page can't be read", () => {
  it("shows the fields for the others and names it", async () => {
    useEntityStore.getState().clear();
    mockedIpc.getPlanetPage.mockImplementation(async (id) => {
      if (id === FROZEN) throw new Error("planet #14 not found");
      return PAGES.find((p) => p.id === id)!;
    });
    await readPages();

    const text = shown(page());
    expect(text).not.toContain("Reading the selected bodies");
    expect(text).toContain("Leaves out Meissa III, whose page couldn't be read.");
    expect(text).toContain("on 1 of 4 · Meissa I");
  });
});
