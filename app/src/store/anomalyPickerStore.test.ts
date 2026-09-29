import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { AnomalyChoice } from "../generated/AnomalyChoice";
import { anomalyPickRows } from "../lib/details/anomalyPicker";
import { mockedIpc } from "../test/ipc";
import { planetPage } from "../test/builders";
import { useAnomalyPickerStore } from "./anomalyPickerStore";
import { bindStores } from "./bindStores";
import { editResult } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { planetPickerTarget } from "./planetEditAdapter";
import { resetStores } from "./storeFixture";

bindStores();

const CHOICES: AnomalyChoice[] = [
  {
    key: "asteroid_uninhabitable_category",
    name: "Asteroid in Orbit",
    level: 2,
    description: null,
    usual: true,
  },
];

const ROW = anomalyPickRows(CHOICES)[0];
const TARGET = planetPickerTarget(planetPage({ id: 40, class: "pc_barren", size: 12 }), true);

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.getAnomalyChoices.mockResolvedValue(CHOICES);
});

describe("the anomaly picker", () => {
  it("reads the categories once for the body it is open on", async () => {
    useAnomalyPickerStore.getState().open(TARGET);
    await vi.waitFor(() => expect(useAnomalyPickerStore.getState().choices?.list).toEqual(CHOICES));
    useAnomalyPickerStore.getState().open(TARGET);
    expect(mockedIpc.getAnomalyChoices).toHaveBeenCalledTimes(1);
    expect(mockedIpc.getAnomalyChoices).toHaveBeenLastCalledWith("pc_barren", 12, true);
  });

  it("reads the categories for a body's page without opening", async () => {
    useAnomalyPickerStore.getState().load(TARGET);
    await vi.waitFor(() => expect(useAnomalyPickerStore.getState().choices?.list).toEqual(CHOICES));
    expect(useAnomalyPickerStore.getState().target).toBeNull();
    useAnomalyPickerStore.getState().open(TARGET);
    expect(mockedIpc.getAnomalyChoices).toHaveBeenCalledTimes(1);
  });

  it("adds the category and closes, as a planet holds one anomaly", async () => {
    useAnomalyPickerStore.getState().open(TARGET);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    await useAnomalyPickerStore.getState().add(ROW);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "AddAnomaly",
      planet: 40,
      category: "asteroid_uninhabitable_category",
    });
    expect(useAnomalyPickerStore.getState().target).toBeNull();
  });

  it("stays open when the add is refused", async () => {
    useAnomalyPickerStore.getState().open(TARGET);
    mockedIpc.applyOp.mockRejectedValue({ kind: "op", message: "planet 40 already has anomaly x" });
    await useAnomalyPickerStore.getState().add(ROW);
    expect(useAnomalyPickerStore.getState().target?.key).toBe("save-planet:40");
  });
});
