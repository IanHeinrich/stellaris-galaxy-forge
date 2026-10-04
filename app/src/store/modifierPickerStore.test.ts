import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { ModifierChoice } from "../generated/ModifierChoice";
import { modifierPickRows } from "../lib/details/modifierPicker";
import { mockedIpc } from "../test/ipc";
import { planetPage } from "../test/builders";
import { bindStores } from "./bindStores";
import { editResult } from "./fixture";
import { useModifierPickerStore } from "./modifierPickerStore";
import { planetPickerTarget } from "./planetEditAdapter";
import { resetStores } from "./storeFixture";
import { useGameDataStore } from "./gameDataStore";

bindStores();

const CHOICES: ModifierChoice[] = [
  {
    modifier: "mineral_poor",
    feature: "pm_mineral_poor",
    category: "Feature",
    description: null,
    view: {
      key: "pm_mineral_poor",
      name: "Mineral Poor",
      static_modifier: "mineral_poor",
      icon: null,
      icon_frame: null,
      effects: [],
    },
  },
];

const ROW = modifierPickRows(CHOICES, [], null, () => "")[0];
const TARGET = planetPickerTarget(planetPage({ id: 40 }), false);

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.getModifierChoices.mockResolvedValue(CHOICES);
});

describe("the modifier picker", () => {
  it("reads the modifiers once while open", async () => {
    useModifierPickerStore.getState().open(TARGET);
    await vi.waitFor(() => expect(useModifierPickerStore.getState().choices).toEqual(CHOICES));
    useModifierPickerStore.getState().open(TARGET);
    expect(mockedIpc.getModifierChoices).toHaveBeenCalledTimes(1);
    expect(useModifierPickerStore.getState().target?.key).toBe("save-planet:40");
  });

  it("adds for the days set, stays open with its search, and says what it added", async () => {
    const store = useModifierPickerStore.getState();
    store.open(TARGET);
    store.setQuery("poor");
    store.setDays(360);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    await useModifierPickerStore.getState().add(ROW);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "AddBodyModifier",
      body: 40,
      modifier: "mineral_poor",
      days: [360],
      feature: "pm_mineral_poor",
    });
    const after = useModifierPickerStore.getState();
    expect([after.target?.key, after.query, after.added]).toEqual([
      "save-planet:40",
      "poor",
      "Added Mineral Poor for 360 days",
    ]);
  });
});
