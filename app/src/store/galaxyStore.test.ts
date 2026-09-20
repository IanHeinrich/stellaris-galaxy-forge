import { beforeEach, describe, expect, it } from "vitest";
import { OPEN_RESULT, SCENARIO_OWNERS, SYSTEMS, TERRITORY } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";

beforeEach(() => {
  useGalaxyStore.getState().clear();
});

describe("galaxyStore", () => {
  it("load indexes the systems in file order and builds the grid", () => {
    const before = useGalaxyStore.getState().version;
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const state = useGalaxyStore.getState();
    expect(state.version).toBe(before + 1);
    expect([...state.systems.keys()]).toEqual(SYSTEMS.map((s) => s.id));
    expect(state.grid?.nearestSystem(0.5, 0.5, 3)?.id).toBe(0);
  });

  it("applyDelta hands out a fresh map with the named systems replaced, and bumps version", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const before = useGalaxyStore.getState();
    const moved = { ...SYSTEMS[2], x: 200, y: 200 };
    before.applyDelta({ systems: [moved] });

    const after = useGalaxyStore.getState();
    expect(after.version).toBe(before.version + 1);
    // A selector on `systems` only re-renders when the map itself is a new one.
    expect(after.systems).not.toBe(before.systems);
    expect(before.systems.get(2)).toBe(SYSTEMS[2]);
    expect(after.lastDelta?.systems).toEqual([moved]);
    expect(after.systems.get(2)).toBe(moved);
    expect(after.systems.size).toBe(6);
    expect(after.grid?.nearestSystem(20, 10, 5)).toBeNull();
    expect(after.grid?.nearestSystem(200, 200, 1)?.id).toBe(2);
    expect(after.systems.get(1)).toBe(SYSTEMS[1]);
    expect(after.nebulae).toBe(OPEN_RESULT.galaxy.nebulae);
  });

  it("applyDelta replaces the header when a delta carries one, else keeps the one loaded", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const before = useGalaxyStore.getState();
    useGalaxyStore.getState().applyDelta({ systems: [] });
    expect(useGalaxyStore.getState().header).toBe(before.header);

    const header = [{ key: "core_radius", value: "25", line: 3 }];
    useGalaxyStore.getState().applyDelta({ systems: [], header });
    expect(useGalaxyStore.getState().header).toBe(header);
  });

  // The map rebuilds and refits on a new `galaxy`, which a header edit must not ask it to do.
  it("applyDelta of a header alone leaves the galaxy object it was loaded with", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const before = useGalaxyStore.getState().galaxy;

    useGalaxyStore.getState().applyDelta({
      systems: [],
      header: [{ key: "core_radius", value: "25", line: 3 }],
    });

    expect(useGalaxyStore.getState().galaxy).toBe(before);
  });

  it("applyDelta replaces the waylines when a delta carries them, else keeps the ones loaded", () => {
    const line = { a: 1, b: 2, network: 0 };
    const station = { system: 1, starbase: 9, network: 0 };
    useGalaxyStore
      .getState()
      .load({ ...OPEN_RESULT.galaxy, waylines: [line], waystations: [station] });
    expect(useGalaxyStore.getState().waylines).toEqual([line]);
    expect(useGalaxyStore.getState().waystations).toEqual([station]);

    useGalaxyStore.getState().applyDelta({ systems: [], removed: [] });
    expect(useGalaxyStore.getState().waylines).toEqual([line]);

    useGalaxyStore.getState().applyDelta({ systems: [], removed: [], waylines: [] });
    expect(useGalaxyStore.getState().waylines).toEqual([]);
    expect(useGalaxyStore.getState().waystations).toEqual([station]);
  });

  it("applyDelta drops every removed system from the map and the grid", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const before = useGalaxyStore.getState();
    before.applyDelta({ systems: [{ ...SYSTEMS[1], lanes: [] }], removed: [0] });

    const after = useGalaxyStore.getState();
    expect(after.version).toBe(before.version + 1);
    expect(after.systems.has(0)).toBe(false);
    expect(after.systems.size).toBe(5);
    expect(after.grid?.nearestSystem(0, 0, 5)).toBeNull();
    expect(after.lastDelta?.removed).toEqual([0]);
  });

  it("applyDelta with nebulae replaces the list and takes membership from the delta", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const before = useGalaxyStore.getState();
    // Deneb (5) left the cloud and Barnard (2) joined it; the cloud itself moved.
    const cloud = { ...OPEN_RESULT.galaxy.nebulae[0], x: 20, y: 10, systems: [2] };
    const deneb = { ...SYSTEMS[5], x: 100, y: 100, nebula: null };
    const barnard = { ...SYSTEMS[2], nebula: 0 };
    before.applyDelta({ systems: [deneb, barnard], nebulae: [cloud] });

    const after = useGalaxyStore.getState();
    expect(after.version).toBe(before.version + 1);
    expect(after.nebulae).toEqual([cloud]);
    expect(after.systems.get(5)).toBe(deneb);
    expect(after.systems.get(2)).toBe(barnard);
    expect(after.grid?.nearestSystem(20, 10, 1)?.nebula).toBe(0);
    for (const id of [0, 1, 3, 4]) expect(after.systems.get(id)).toBe(SYSTEMS[id]);

    // A delta without nebulae leaves them alone.
    after.applyDelta({ systems: [] });
    expect(useGalaxyStore.getState().nebulae).toEqual([cloud]);
    expect(useGalaxyStore.getState().systems.get(2)?.nebula).toBe(0);

    // An empty list is the document saying it now holds none, not "unchanged".
    after.applyDelta({ systems: [{ ...barnard, nebula: null }], nebulae: [] });
    expect(useGalaxyStore.getState().nebulae).toEqual([]);
    expect(useGalaxyStore.getState().systems.get(2)?.nebula).toBeNull();
  });

  it("centralSystem picks the owned system nearest the middle of the territory", () => {
    const owned = OPEN_RESULT.galaxy.systems.map((s) =>
      s.id === 5 ? s : { ...s, owner: s.id === 4 ? 2 : 1 },
    );
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: owned });
    expect(useGalaxyStore.getState().centralSystem(1)).toBe(1);
    expect(useGalaxyStore.getState().centralSystem(2)).toBe(4);
    expect(useGalaxyStore.getState().centralSystem(9)).toBeNull();
    expect(useGalaxyStore.getState().systemName(0)).toBe("Sol");
  });

  it("setScriptedOwners stamps its systems, draws its countries, and survives a re-projection", () => {
    const owners = new Map(SCENARIO_OWNERS.owners.map((o) => [o.system, o.territory]));
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    useGalaxyStore.getState().setScriptedOwners(owners, [TERRITORY]);

    const stamped = useGalaxyStore.getState();
    expect(stamped.systems.get(1)?.owner).toBe(TERRITORY.id);
    expect(stamped.systems.get(2)?.owner).toBe(TERRITORY.id);
    expect(stamped.systems.get(3)?.owner).toBeNull();
    // The Empires tab, the owners layer and the inspector's swatch all read this one map.
    expect(stamped.countries.get(TERRITORY.id)).toBe(TERRITORY);
    expect(stamped.lastDelta?.systems.map((s) => s.id)).toEqual([1, 2]);

    // A moved system comes back re-projected with no owner of its own and is stamped again.
    useGalaxyStore.getState().applyDelta({ systems: [{ ...SYSTEMS[2], x: 200, y: 200 }] });
    const moved = useGalaxyStore.getState().systems.get(2);
    expect(moved?.owner).toBe(TERRITORY.id);
    expect(moved?.x).toBe(200);
    expect(useGalaxyStore.getState().grid?.nearestSystem(200, 200, 1)?.owner).toBe(TERRITORY.id);

    // A load is a new document: nothing of the last one's scripts follows it in.
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    const opened = useGalaxyStore.getState();
    expect(opened.systems.get(1)?.owner).toBeNull();
    expect(opened.countries.has(TERRITORY.id)).toBe(false);
    expect(opened.scriptedOwners.size).toBe(0);
    expect(opened.scriptedCountries).toEqual([]);

    // The reading that follows the open stamps it again.
    useGalaxyStore.getState().setScriptedOwners(owners, [TERRITORY]);
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBe(TERRITORY.id);

    useGalaxyStore.getState().setScriptedOwners(new Map(), []);
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBeNull();
    expect(useGalaxyStore.getState().countries.size).toBe(0);
  });

  it("toggleCountryHidden hides one country at a time and a load starts them all shown", () => {
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    useGalaxyStore.getState().toggleCountryHidden(3);
    useGalaxyStore.getState().toggleCountryHidden(7);
    expect([...useGalaxyStore.getState().hiddenCountries]).toEqual([3, 7]);

    useGalaxyStore.getState().toggleCountryHidden(3);
    expect([...useGalaxyStore.getState().hiddenCountries]).toEqual([7]);

    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    expect(useGalaxyStore.getState().hiddenCountries.size).toBe(0);
  });
});
