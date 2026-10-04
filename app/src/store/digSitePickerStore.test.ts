import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { DigSiteChoice } from "../generated/DigSiteChoice";
import { digSitePickRows } from "../lib/details/digSitePicker";
import { mockedIpc } from "../test/ipc";
import { planetPage } from "../test/builders";
import { bindStores } from "./bindStores";
import { useDigSitePickerStore } from "./digSitePickerStore";
import { editResult } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { planetPickerTarget } from "./planetEditAdapter";
import { resetStores } from "./storeFixture";

bindStores();

const CHOICES: DigSiteChoice[] = [
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

const ROW = digSitePickRows(CHOICES)[0];
const TARGET = planetPickerTarget(planetPage({ id: 585 }), false);

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({ status: "ready" });
  mockedIpc.getDigSiteChoices.mockResolvedValue(CHOICES);
});

describe("the dig site picker", () => {
  it("reads the site types once", async () => {
    useDigSitePickerStore.getState().open(TARGET);
    useDigSitePickerStore.getState().read();
    await vi.waitFor(() => expect(useDigSitePickerStore.getState().choices).toEqual(CHOICES));
    useDigSitePickerStore.getState().open(TARGET);
    expect(mockedIpc.getDigSiteChoices).toHaveBeenCalledTimes(1);
    expect(useDigSitePickerStore.getState().target?.key).toBe("save-planet:585");
  });

  it("adds a site at its type's first stage and closes, since a planet holds one", async () => {
    useDigSitePickerStore.getState().open(TARGET);
    useDigSitePickerStore.getState().setQuery("never");
    mockedIpc.applyOp.mockResolvedValue(editResult());
    await useDigSitePickerStore.getState().add(ROW);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "AddDigSite",
      body: 585,
      site_type: "site_lost_moments",
      difficulty: 1,
    });
    const after = useDigSitePickerStore.getState();
    expect([after.target, after.query]).toEqual([null, ""]);
  });

  it("stays open when the add is refused", async () => {
    useDigSitePickerStore.getState().open(TARGET);
    mockedIpc.applyOp.mockRejectedValue({
      kind: "op",
      message: "planet 585 already has dig site 4",
    });
    await useDigSitePickerStore.getState().add(ROW);
    expect(useDigSitePickerStore.getState().target?.key).toBe("save-planet:585");
  });
});
