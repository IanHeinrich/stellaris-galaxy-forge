import type { PlanetPage } from "../generated/PlanetPage";
import { planetSummary } from "./fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { AnomalyChoice } from "../generated/AnomalyChoice";
import type { DepositChoice } from "../generated/DepositChoice";
import type { DigSiteChoice } from "../generated/DigSiteChoice";
import type { EditResult } from "../generated/EditResult";
import type { ModifierChoice } from "../generated/ModifierChoice";
import { anomalyPickRows } from "../lib/details/anomalyPicker";
import { depositRows } from "../lib/details/depositPicker";
import { digSitePickRows } from "../lib/details/digSitePicker";
import { modifierPickRows } from "../lib/details/modifierPicker";
import type { PickerTarget } from "../lib/details/picker";
import { planetPage } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { useAnomalyPickerStore } from "./anomalyPickerStore";
import { bindStores } from "./bindStores";
import { useDepositPickerStore } from "./depositPickerStore";
import { useDigSitePickerStore } from "./digSitePickerStore";
import { editResult } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useModifierPickerStore } from "./modifierPickerStore";
import { heldAnomaly, savePickerTarget } from "./planetEditAdapter";
import { resetStores } from "./storeFixture";
import { until } from "../test/wait";
import { flush } from "../test/flush";

/** Save body `page` in system 1, as its page hands it to the pickers. */
const pickerTarget = (page: PlanetPage) =>
  savePickerTarget(
    1,
    planetSummary({ id: page.id, class: page.class, size: page.size }),
    page,
    heldAnomaly(page),
  );

bindStores();

const ANOMALIES: AnomalyChoice[] = [
  { key: "asteroid_category", name: "Asteroid in Orbit", level: 2, description: null, usual: true },
];
const DEPOSITS: DepositChoice[] = [
  {
    key: "d_energy_1",
    family: "d_energy",
    amount: 1,
    category: "Energy",
    usual: true,
    description: null,
    event_only: false,
  },
];
const SITES: DigSiteChoice[] = [
  {
    key: "site_lost_moments",
    name: "Never Forget",
    description: null,
    difficulty: 1,
    stages: 3,
    rolled: true,
    offered: true,
  },
];
const MODIFIERS: ModifierChoice[] = [
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

const A = pickerTarget(planetPage({ id: 40, class: "pc_barren", size: 12 }));
const B = pickerTarget(planetPage({ id: 41, class: "pc_desert", size: 18 }));

/** What the table reads and drives of one picker's store. */
interface Picker {
  name: string;
  /** The ask the store makes for its choices. */
  ask: { mockReturnValueOnce(reply: never): { mockReturnValueOnce(reply: never): unknown } };
  list: unknown[];
  /** Whether the list depends on the body it is open on. */
  perBody: boolean;
  /** Whether a planet holds one, so an add closes the picker. */
  closesOnAdd: boolean;
  open(target: PickerTarget): void;
  load(target: PickerTarget): void;
  close(): void;
  add(): Promise<void>;
  state(): {
    target: PickerTarget | null;
    added: string | null;
    choices: { list: unknown[] } | null;
  };
}

const PICKERS: Picker[] = [
  {
    name: "anomaly",
    ask: mockedIpc.getAnomalyChoices,
    list: ANOMALIES,
    perBody: true,
    closesOnAdd: true,
    open: (t) => useAnomalyPickerStore.getState().open(t),
    load: (t) => useAnomalyPickerStore.getState().load(t),
    close: () => useAnomalyPickerStore.getState().close(),
    add: () => useAnomalyPickerStore.getState().add(anomalyPickRows(ANOMALIES)[0]),
    state: () => useAnomalyPickerStore.getState(),
  },
  {
    name: "deposit",
    ask: mockedIpc.getDepositChoices,
    list: DEPOSITS,
    perBody: true,
    closesOnAdd: false,
    open: (t) => useDepositPickerStore.getState().open(t, "deposits"),
    load: (t) => useDepositPickerStore.getState().load(t),
    close: () => useDepositPickerStore.getState().close(),
    add: () => {
      const [row] = depositRows(DEPOSITS, new Map(), "deposits");
      return useDepositPickerStore.getState().add(row, row.amounts[0]);
    },
    state: () => useDepositPickerStore.getState(),
  },
  {
    name: "dig site",
    ask: mockedIpc.getDigSiteChoices,
    list: SITES,
    perBody: false,
    closesOnAdd: true,
    open: (t) => useDigSitePickerStore.getState().open(t),
    load: (t) => useDigSitePickerStore.getState().load(t),
    close: () => useDigSitePickerStore.getState().close(),
    add: () => useDigSitePickerStore.getState().add(digSitePickRows(SITES)[0]),
    state: () => useDigSitePickerStore.getState(),
  },
  {
    name: "modifier",
    ask: mockedIpc.getModifierChoices,
    list: MODIFIERS,
    perBody: false,
    closesOnAdd: false,
    open: (t) => useModifierPickerStore.getState().open(t),
    load: (t) => useModifierPickerStore.getState().load(t),
    close: () => useModifierPickerStore.getState().close(),
    add: () =>
      useModifierPickerStore.getState().add(modifierPickRows(MODIFIERS, [], null, () => "")[0]),
    state: () => useModifierPickerStore.getState(),
  },
];

/** The list the picker holds, or null while it holds none. */
function shown(picker: Picker): unknown[] | null {
  return picker.state().choices?.list ?? null;
}

/** A reply held until the test lets it land. */
function held<T>() {
  let land!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (land = resolve));
  return { promise, land };
}

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.getAnomalyChoices.mockResolvedValue(ANOMALIES);
  mockedIpc.getDepositChoices.mockResolvedValue(DEPOSITS);
  mockedIpc.getDigSiteChoices.mockResolvedValue(SITES);
  mockedIpc.getModifierChoices.mockResolvedValue(MODIFIERS);
  mockedIpc.getDepositTypes.mockResolvedValue([]);
});

describe.each(PICKERS)("the $name picker", (picker) => {
  it("reads its list once for the body it is open on", async () => {
    picker.open(A);
    await until(() => expect(shown(picker)).toEqual(picker.list));
    picker.open(A);
    expect(picker.ask).toHaveBeenCalledTimes(1);
    expect(picker.state().target?.key).toBe(A.key);
  });

  it("reads its list for a body's page without opening", async () => {
    picker.load(A);
    await until(() => expect(shown(picker)).toEqual(picker.list));
    expect(picker.state().target).toBeNull();
    picker.open(A);
    expect(picker.ask).toHaveBeenCalledTimes(1);
  });

  it("reads its list again once the game data is reloaded", async () => {
    picker.open(A);
    await until(() => expect(shown(picker)).toEqual(picker.list));
    picker.close();
    useGameDataStore.setState({ version: useGameDataStore.getState().version + 1 });
    picker.open(A);
    expect(picker.ask).toHaveBeenCalledTimes(2);
  });

  it(picker.closesOnAdd ? "closes after an add" : "stays open after an add", async () => {
    picker.open(A);
    mockedIpc.applyOp.mockResolvedValue(editResult());
    await picker.add();
    expect(picker.state().target?.key ?? null).toBe(picker.closesOnAdd ? null : A.key);
  });

  it("stays open when the add is refused", async () => {
    picker.open(A);
    mockedIpc.applyOp.mockRejectedValue({ kind: "op", message: "refused" });
    await picker.add();
    expect(picker.state().target?.key).toBe(A.key);
    expect(picker.state().added).toBeNull();
  });

  it("leaves another planet's picker alone when a late add lands", async () => {
    picker.open(A);
    const reply = held<EditResult>();
    mockedIpc.applyOp.mockReturnValueOnce(reply.promise);
    const adding = picker.add();
    picker.open(B);
    reply.land(editResult());
    await adding;
    expect(picker.state().target?.key).toBe(B.key);
    expect(picker.state().added).toBeNull();
  });
});

describe.each(PICKERS.filter((p) => p.perBody))("the $name picker on another body", (picker) => {
  it("shows no list until the new body's lands", async () => {
    picker.open(A);
    await until(() => expect(shown(picker)).toEqual(picker.list));
    const reply = held<never[]>();
    picker.ask.mockReturnValueOnce(reply.promise as never);
    picker.open(B);
    expect(shown(picker)).toBeNull();
    reply.land([]);
    await until(() => expect(shown(picker)).toEqual([]));
  });

  it("keeps the list of the body it is open on when an older reply lands last", async () => {
    const first = held<unknown[]>();
    const second = held<unknown[]>();
    picker.ask
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    picker.open(A);
    picker.open(B);
    second.land(picker.list);
    await flush();
    first.land([]);
    await flush();
    expect(shown(picker)).toEqual(picker.list);
  });
});
