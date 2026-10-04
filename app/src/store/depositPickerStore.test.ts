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
import { planetPickerTarget } from "./planetEditAdapter";
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
  it("holds an add with warnings until it is asked for again, and drops it on cancel", async () => {
    const store = useDepositPickerStore.getState();
    store.open(planetPickerTarget(PAGE, false), "deposits");
    await vi.waitFor(() => expect(useDepositPickerStore.getState().choices).not.toBeNull());
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const [row] = depositRows(CHOICES, new Map(), "deposits");
    const warnings = ["The game may demolish 1 district within a month."];

    await store.add(row, row.amounts[0], warnings);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(useDepositPickerStore.getState().pending?.warnings).toEqual(warnings);
    store.cancel();
    expect(useDepositPickerStore.getState().pending).toBeNull();

    await store.add(row, row.amounts[1], warnings);
    await store.add(row, row.amounts[0], warnings);
    expect(useDepositPickerStore.getState().pending?.amount).toBe(row.amounts[0]);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    // Asking again for the held amount, as Enter in the search does, confirms it.
    await store.add(row, row.amounts[0], warnings);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddDeposit",
      body: 40,
      kind: "d_energy_1",
    });
    expect(useDepositPickerStore.getState()).toMatchObject({
      pending: null,
      added: "Added +1 d_energy_1",
    });
  });

  it("stays open with its search after an add, and says what it added", async () => {
    const store = useDepositPickerStore.getState();
    store.open(planetPickerTarget(PAGE, false), "deposits");
    store.setQuery("energy");
    await vi.waitFor(() => expect(useDepositPickerStore.getState().choices).not.toBeNull());
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const [row] = depositRows(CHOICES, new Map(), "deposits");
    await store.add(row, row.amounts[1]);

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "AddDeposit",
      body: 40,
      kind: "d_energy_3",
    });
    const state = useDepositPickerStore.getState();
    expect(state.target?.key).toBe("save-planet:40");
    expect(state.query).toBe("energy");
    expect(state.added).toBe("Added +3 d_energy_1");

    // The planet read again holds the new deposit, so the types are read again for it.
    const reread = { ...PAGE, deposits: [{ id: 9, kind: "d_energy_3", swap_type: null }] };
    store.open(planetPickerTarget(reread, false), "deposits");
    expect(mockedIpc.getDepositChoices).toHaveBeenLastCalledWith("pc_barren", 16, false, [
      "d_energy_3",
    ]);
    expect(useDepositPickerStore.getState().added).toBe("Added +3 d_energy_1");

    store.close();
    expect(useDepositPickerStore.getState()).toMatchObject({
      target: null,
      query: "",
      added: null,
    });
  });
});
