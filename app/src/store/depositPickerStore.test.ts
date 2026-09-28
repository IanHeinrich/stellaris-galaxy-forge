import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { DepositChoice } from "../generated/DepositChoice";
import { depositRows } from "../lib/details/depositPicker";
import { mockedIpc } from "../test/ipc";
import { planetPage } from "../test/builders";
import { bindStores } from "./bindStores";
import { useDepositPickerStore } from "./depositPickerStore";
import { editResult } from "./fixture";
import { resetStores } from "./storeFixture";
import { useGameDataStore } from "./gameDataStore";

bindStores();

const CHOICES: DepositChoice[] = [
  {
    key: "d_energy_1",
    family: "d_energy",
    amount: 1,
    category: "Energy",
    usual: true,
    description: null,
    event_only: false,
  },
  {
    key: "d_energy_3",
    family: "d_energy",
    amount: 3,
    category: "Energy",
    usual: false,
    description: null,
    event_only: false,
  },
];

const PAGE = planetPage({ id: 40, class: "pc_barren" });

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.getDepositChoices.mockResolvedValue(CHOICES);
  mockedIpc.getDepositTypes.mockResolvedValue([]);
});

describe("the deposit picker", () => {
  it("holds an add with warnings until it is confirmed, and drops it on cancel", async () => {
    const store = useDepositPickerStore.getState();
    store.open(PAGE, false, "deposits");
    await vi.waitFor(() => expect(useDepositPickerStore.getState().choices).not.toBeNull());
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const [row] = depositRows(CHOICES, new Map(), "deposits");
    const warnings = ["The game may demolish 1 district within a month."];

    await store.add(row, row.amounts[0], warnings);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(useDepositPickerStore.getState().pending?.warnings).toEqual(warnings);
    store.cancel();
    expect(useDepositPickerStore.getState().pending).toBeNull();

    await store.add(row, row.amounts[0], warnings);
    await store.confirm();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddSaveDeposit",
      planet: 40,
      kind: "d_energy_1",
    });
    expect(useDepositPickerStore.getState()).toMatchObject({
      pending: null,
      added: "Added +1 d_energy_1",
    });
  });

  it("reads the types offered for the planet once, when it opens", async () => {
    useDepositPickerStore.getState().open(PAGE, true, "deposits");
    await vi.waitFor(() => expect(useDepositPickerStore.getState().choices?.list).toEqual(CHOICES));
    expect(mockedIpc.getDepositChoices).toHaveBeenCalledWith("pc_barren", 16, true, []);
    useDepositPickerStore.getState().open(PAGE, true, "deposits");
    expect(mockedIpc.getDepositChoices).toHaveBeenCalledTimes(1);
    expect(useDepositPickerStore.getState().planet).toBe(40);
  });

  it("stays open with its search after an add, and says what it added", async () => {
    const store = useDepositPickerStore.getState();
    store.open(PAGE, false, "deposits");
    store.setQuery("energy");
    await vi.waitFor(() => expect(useDepositPickerStore.getState().choices).not.toBeNull());
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const [row] = depositRows(CHOICES, new Map(), "deposits");
    await store.add(row, row.amounts[1]);

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddSaveDeposit",
      planet: 40,
      kind: "d_energy_3",
    });
    const state = useDepositPickerStore.getState();
    expect(state.planet).toBe(40);
    expect(state.query).toBe("energy");
    expect(state.added).toBe("Added +3 d_energy_1");

    // The planet read again holds the new deposit, so the types are read again for it.
    store.open(
      { ...PAGE, deposits: [{ id: 9, kind: "d_energy_3", swap_type: null }] },
      false,
      "deposits",
    );
    expect(mockedIpc.getDepositChoices).toHaveBeenLastCalledWith("pc_barren", 16, false, [
      "d_energy_3",
    ]);
    expect(useDepositPickerStore.getState().added).toBe("Added +3 d_energy_1");

    store.close();
    expect(useDepositPickerStore.getState()).toMatchObject({
      planet: null,
      query: "",
      added: null,
    });
  });
});
