import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnModifier } from "../../../generated/SpawnModifier";
import type { SystemNode } from "../../../generated/SystemNode";
import {
  DAY_ONE_OWNER,
  DAY_ONE_TERRITORY,
  SCENARIO_BYPASSES,
  SCENARIO_OWNERS,
  SYSTEM_SCRIPTS,
  TERRITORY,
  detailOf,
  entityNode,
  entitySource,
  entityView,
  name,
  scalar,
} from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { enabledScript, scriptForKind } from "../../../lib/paint";
import { isSpawnWeight } from "../../../lib/spawn";
import { kindTitle } from "../../../lib/special";
import { DETAILS_DEBOUNCE_MS } from "../../../store/batching";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { addrKey, useEntityStore, viewKey } from "../../../store/entityStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { tabsFor, useInspectorStore } from "../../../store/inspectorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { useScriptsStore } from "../../../store/scriptsStore";
import {
  details,
  land,
  mocked,
  open,
  overview,
  planet,
  resetStores,
  sections,
  SYSTEM,
} from "../inspectorFixture";
import { preventLaneOp, preventTarget, unpreventLaneOp } from "./sections/scenario/prevented";
import { SCRIPTS_LIMITS, SCRIPTS_TAB_TITLE } from "./sections/scenario/ScriptsTab";
import { DEFAULT_SPAWN_WEIGHT, spawnPointOp } from "./sections/scenario/spawnPoint";
import { renameSystemOp } from "./systemName";
import { SystemView } from "./SystemView";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a scenario system's overview", () => {
  it("shows the bodies, station and megastructures of its record in place of the initializer's list", async () => {
    await open("scenario");
    await land(
      details({
        planets: [planet(100, "Tarkin"), planet(101, "Yavin")],
        resources: [{ resource: "minerals", amount: 7 }],
        starbase: {
          level: "starbase_level_starport",
          kind: "starbase_starport",
          name: name("Bastion"),
          name_key: "Bastion",
          owner: null,
          modules: ["shipyard"],
          buildings: [],
          id: 0,
          hull: 0,
          max_hull: 0,
          shipyard: true,
        },
        megastructures: [{ id: 5, kind: "ring_world_ruined", owner: null, planet: null }],
      }),
    );

    const html = overview();
    expect(sections(html)).toEqual([
      "Position",
      "Spawn point",
      "Initializer",
      "Planets · 2 · 0 colonies",
      "Station",
      "Megastructures · 1",
      "Hyperlanes · 4",
      "Scripts · …",
    ]);
    expect(html).toContain("Tarkin");
    expect(html).toContain("2 planets");
    expect(html).toContain("System total");
    expect(html).toContain('title="Minerals 7"');
    expect(html).toContain("Starport");
    expect(html).toContain("Ring World");
    // The initializer places these very bodies: its own list would say them twice.
    expect(html).not.toContain("Kepler");
    // Nothing to drill into: a scenario holds no planet, station or megastructure entities.
    expect(html).toContain('class="ins-prow static"');
    expect(html).not.toContain('class="ins-prow" role="button"');
  });

  it("shows the resource total and the initializer's list when the record carries resources alone", async () => {
    await open("scenario");
    await land(
      details({
        resources: [
          { resource: "minerals", amount: 7 },
          { resource: "energy", amount: 3.5 },
        ],
      }),
    );

    const html = overview();
    expect(sections(html)).toEqual([
      "Position",
      "Spawn point",
      "Initializer",
      "Resources · 2",
      "Hyperlanes · 4",
      "Scripts · …",
    ]);
    expect(html).toContain("System total");
    expect(html).toContain('title="Minerals 7"');
    expect(html).toContain('title="Energy 3.5"');
    expect(html).toContain("Kepler");
  });

  it("shows no resources and no save-only sections while no record has arrived", async () => {
    await open("scenario");

    const html = overview();
    expect(sections(html)).toEqual([
      "Position",
      "Spawn point",
      "Initializer",
      "Hyperlanes · 4",
      "Scripts · …",
    ]);
    expect(html).toContain("Kepler");
    expect(html).not.toContain("System total");
    expect(html).not.toContain("Reading the system");
  });
});

/** Answers `getSystem` with the fixture's detail, but `id`'s system stamped with `owner`. */
function ownerDetail(id: number, owner: number): void {
  mocked.getSystem.mockImplementation(async (reqId) => {
    const detail = detailOf(reqId);
    return reqId === id ? { ...detail, system: { ...detail.system, owner } } : detail;
  });
}

describe("a scenario system's owner line", () => {
  it("names the day-one claim and marks it assumed", async () => {
    ownerDetail(0, DAY_ONE_TERRITORY.id);
    await open("scenario");
    useGameDataStore.setState({
      scenarioOwners: { ...SCENARIO_OWNERS, owners: [...SCENARIO_OWNERS.owners, DAY_ONE_OWNER] },
    });
    await useEditorStore.getState().select(0);

    const html = renderToStaticMarkup(<SystemView id={0} />);
    expect(html).toContain(">day 1 · fixture.2<");
    expect(html).toContain(">assumed<");
  });

  it("marks the claim's source: the initializers at generation, the scripts on day one", async () => {
    ownerDetail(0, DAY_ONE_TERRITORY.id);
    await open("scenario");
    useGameDataStore.setState({
      scenarioOwners: { ...SCENARIO_OWNERS, owners: [...SCENARIO_OWNERS.owners, DAY_ONE_OWNER] },
    });
    await useEditorStore.getState().select(0);

    const dayOne = renderToStaticMarkup(<SystemView id={0} />);
    expect(dayOne).toContain('<span class="chip src" title="The owner is the one an event claims');

    ownerDetail(1, TERRITORY.id);
    await open("scenario");
    useGameDataStore.setState({ scenarioOwners: SCENARIO_OWNERS });

    const generation = overview();
    expect(generation).toContain(
      '<span class="chip init" title="The owner is the one the initializer',
    );
    expect(generation).not.toContain("The owner is the one an event claims");
  });

  it("carries neither chip for a system claimed at generation", async () => {
    ownerDetail(1, TERRITORY.id);
    await open("scenario");
    useGameDataStore.setState({ scenarioOwners: SCENARIO_OWNERS });

    const html = overview();
    expect(html).not.toContain(">day 1");
    expect(html).not.toContain(">assumed<");
  });
});

describe("a scenario system's bypasses", () => {
  it("names each endpoint, where it leads and which reader found it", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });

    const html = overview();
    expect(sections(html)).toContain("Bypasses · 1");
    expect(html).toContain("Natural wormhole");
    // The partner is named, not numbered, and the row jumps to it.
    expect(html).toContain("Barnard");
    expect(html).toContain('title="Jump to #2"');
    expect(html).toContain('<span class="chip init" title="Placed by the initializer');
  });

  it("marks a day-one endpoint with the scripts that place it, and says when it is assumed", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });
    await useEditorStore.getState().select(0);

    const html = renderToStaticMarkup(<SystemView id={0} />);
    expect(html).toContain("Gateway (ruined)");
    expect(html).toContain('<span class="chip src" title="Placed on day one by fixture.9"');
    expect(html).toContain(">assumed<");
  });

  it("leaves the section out for a system no bypass touches, and without game data", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });
    await useEditorStore.getState().select(3);
    expect(
      sections(renderToStaticMarkup(<SystemView id={3} />)).some((s) => s.startsWith("Bypasses")),
    ).toBe(false);

    useGameDataStore.setState({ scenarioBypasses: null });
    expect(overview()).not.toContain("Natural wormhole");
  });
});

describe("a system's contents", () => {
  it("says why the read failed rather than reading for ever", async () => {
    await open("scenario");
    useInspectorStore.setState({ tab: "contents" });
    mocked.getSystemDetails.mockRejectedValue({ kind: "no_session", message: "nothing open" });

    useDetailsStore.getState().request([SYSTEM]);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);

    const html = overview();
    expect(html).toContain("The contents could not be read: nothing open");
    expect(html).not.toContain("Reading the system");
  });

  it("reads them again once an edit invalidates the failure", async () => {
    await open("scenario");
    useInspectorStore.setState({ tab: "contents" });
    mocked.getSystemDetails.mockRejectedValueOnce({ kind: "no_session", message: "nothing open" });
    useDetailsStore.getState().request([SYSTEM]);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);

    useDetailsStore.getState().invalidate([SYSTEM]);
    await land(details());

    expect(overview()).not.toContain("could not be read");
  });
});

/** The entity a Data or Source tab is waiting on, as an answered read lands it. */
function landEntity(): void {
  const addr = { kind: "system", id: SYSTEM } as const;
  const view = entityView("system", {
    addr,
    nodes: [entityNode("initializer", scalar("basic_init_01"))],
  });
  useEntityStore.setState({
    views: new Map([[viewKey(addr, []), view]]),
    sources: new Map([[addrKey(addr), entitySource("system", { addr, text: "id=1" })]]),
  });
}

describe("a scenario system's source", () => {
  it("reads the system's own text, and offers no Data table beside it", async () => {
    await open("scenario");
    landEntity();

    useInspectorStore.setState({ tab: "source" });
    const source = overview();
    expect(source).toContain("id=1");
    expect(source).not.toContain("no text of their own");

    const ref = { kind: "system", id: SYSTEM } as const;
    expect(tabsFor(ref, true, { scripts: true, data: false })).not.toContain("data");
    expect(tabsFor(ref)).toContain("data");
  });

  it("waits for the entity rather than showing text of its own", async () => {
    await open("scenario");
    useInspectorStore.setState({ tab: "source" });

    expect(overview()).toContain("Reading the system");
  });
});

/** The system as the projection reports it once its statement carries `spawn_weight`. */
function withWeight(weight: number | null, initializer = "basic_init_01"): void {
  mocked.getSystem.mockImplementation(async (id) => {
    const detail = detailOf(id);
    return { ...detail, system: { ...detail.system, spawn_weight: weight, initializer } };
  });
}

describe("a scenario system's spawn weight", () => {
  it("offers the toggle unchecked, checked with its weight, and disabled without an initializer", async () => {
    withWeight(null);
    await open("scenario");
    useInspectorStore.setState({ sections: { "system.initializer": false } });
    expect(overview()).toContain("Spawn point");
    expect(overview()).not.toContain('aria-label="Spawn weight"');

    withWeight(3);
    await open("scenario");
    const on = overview();
    expect(on).toContain("checked=");
    expect(on).toContain('aria-label="Spawn weight"');
    expect(on).toContain('value="3"');

    withWeight(null, "");
    await open("scenario");
    const without = overview();
    expect(without).toContain("disabled=");
    expect(without).toContain("choose one first");
  });

  it("sends the weight the toggle writes, and clears it when it is turned off", async () => {
    withWeight(null);
    await open("scenario");
    const system = useEditorStore.getState().inspected!.system;

    await useEditorStore.getState().applyOp(spawnPointOp(system, DEFAULT_SPAWN_WEIGHT, false));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetSpawnWeight",
      id: SYSTEM,
      base: 1,
    });

    await useEditorStore
      .getState()
      .applyOp(spawnPointOp({ ...system, spawn_weight: 1 }, null, false));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetSpawnWeight",
      id: SYSTEM,
      base: null,
    });
  });

  it("takes only a weight above zero, so nothing writes a system out of the draw", () => {
    expect(isSpawnWeight(DEFAULT_SPAWN_WEIGHT)).toBe(true);
    expect(isSpawnWeight(0.25)).toBe(true);
    expect(isSpawnWeight(0)).toBe(false);
    expect(isSpawnWeight(-3)).toBe(false);
  });
});

describe("a scenario system's spawn reservation", () => {
  /** The system as the projection reports its `spawn_weight` block. */
  function withSpawn(extra: Partial<SystemNode>): void {
    mocked.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, ...extra } };
    });
  }

  function modifier(extra: Partial<SpawnModifier>): SpawnModifier {
    return { factor: null, add: null, trigger: "", reservation: null, ...extra };
  }

  /**
   * The section's checkboxes as they are rendered: the spawn point first, then the human
   * reservation and the AI one.
   */
  function boxes(html: string): string[] {
    return [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
  }

  const HUMAN = modifier({ factor: 0, trigger: "is_ai = yes", reservation: "human" });
  const AI = modifier({ factor: 0, trigger: "is_ai = no", reservation: "ai" });

  it("checks the box of the kind of empire a modifier holds the system for", async () => {
    withSpawn({ spawn_weight: 1, spawn_modifiers: [HUMAN] });
    await open("scenario");

    const held = overview();
    expect(held).toContain("Reserve for a human player");
    expect(held).toContain("Reserve for the AI");
    expect(boxes(held)[1]).toContain("checked");
    expect(boxes(held)[2]).not.toContain("checked");

    withSpawn({ spawn_weight: 1, spawn_modifiers: [AI] });
    await open("scenario");
    expect(boxes(overview())[1]).not.toContain("checked");
    expect(boxes(overview())[2]).toContain("checked");

    withSpawn({ spawn_weight: 1, spawn_modifiers: [] });
    await open("scenario");
    for (const off of boxes(overview()).slice(1)) {
      expect(off).not.toContain("checked");
      expect(off).not.toContain("disabled");
    }
  });

  it("refuses a system the generator never draws, and says why", async () => {
    withSpawn({ spawn_weight: null });
    await open("scenario");
    expect(boxes(overview())[1]).toContain("disabled");
    expect(boxes(overview())[2]).toContain("disabled");
    expect(overview()).toContain("make this a spawn point first");

    withSpawn({ spawn_weight: 0 });
    await open("scenario");
    expect(boxes(overview())[1]).toContain("disabled");
  });

  /** Clearing the weight clears the reservation with it, which the core writes in one op. */
  it("leaves both boxes unchecked once the spawn point is turned off", async () => {
    withSpawn({ spawn_weight: 1, spawn_modifiers: [HUMAN] });
    await open("scenario");
    expect(boxes(overview())[1]).toContain("checked");

    withSpawn({ spawn_weight: null, spawn_modifiers: [] });
    await open("scenario");
    const cleared = boxes(overview());
    expect(cleared[0]).not.toContain("checked");
    for (const box of cleared.slice(1)) {
      expect(box).not.toContain("checked");
      expect(box).toContain("disabled");
    }
  });

  it("lists every modifier as the file writes it, chipping the ones it recognises", async () => {
    withSpawn({
      spawn_weight: 2,
      spawn_design: "player_design",
      spawn_modifiers: [
        HUMAN,
        modifier({
          add: 5,
          trigger: "has_country_flag = my_flag",
          reservation: { country_flag: "my_flag" },
        }),
        modifier({ factor: 2, trigger: "has_star_flag = empire_cluster" }),
      ],
    });
    await open("scenario");

    const html = overview();
    expect(html).toContain("Modifiers · 3");
    expect(html).toContain("×0");
    expect(html).toContain("is_ai = yes");
    expect(html).toContain('<span class="chip">human</span>');
    expect(html).toContain("+5");
    expect(html).toContain('<span class="chip">flag: my_flag</span>');
    // Script this editor does not read is still shown, by the trigger it states.
    expect(html).toContain("×2");
    expect(html).toContain("has_star_flag = empire_cluster");
    expect(html).toContain("player_design");
  });
});

describe("a scenario system Paint a Galaxy seats", () => {
  /** The system as the projection reads the site's `spawn_weight` idiom. */
  function withScript(kind: "enabled" | "preferred" | "sol" | { reserved: string }): void {
    mocked.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return {
        ...detail,
        system: {
          ...detail.system,
          spawn_weight: 0,
          spawn_script: { paint_a_galaxy: { kind, random_value: 4 } },
        },
      };
    });
  }

  it("offers the seat's kind in place of the weight and the reservations", async () => {
    withScript({ reserved: "c" });
    await open("scenario");
    useInspectorStore.setState({ sections: { "system.initializer": false } });

    const html = overview();
    expect(html).toContain(">Seat<");
    expect(html).toContain('<optgroup label="Reserved for one empire">');
    expect(html).toContain('<option value="reserved:c" selected="">Reserved C</option>');
    expect(html.match(/<option /g)).toHaveLength(29);
    expect(html).toContain("Only an empire whose species has the");
    expect(html).toContain("Reserved Spawn C");
    expect(html).toContain("trait starts here.");
    expect(html).toContain("The trait comes from the");
    expect(html).toContain("Reserved Spawns submod ↗");
    expect(html.match(/<input type="checkbox"[^>]*>/g)).toHaveLength(1);
    expect(html.match(/<input type="checkbox"[^>]*>/)![0]).toContain("checked=");
    expect(html).not.toContain('aria-label="Spawn weight"');
    expect(html).not.toContain("Reserve for a human player");
    expect(html).not.toContain("Reserve for the AI");
  });

  it("describes what each kind means, a reserved letter's sentence pointing at the submod", async () => {
    withScript("enabled");
    await open("scenario");
    expect(overview()).toContain("Any empire may start here.");
    expect(overview()).not.toContain("The trait comes from the");

    withScript("preferred");
    await open("scenario");
    expect(overview()).toContain("Filled before enabled seats.");

    withScript("sol");
    await open("scenario");
    expect(overview()).toContain(
      "United Nations of Earth counts as holding it. Set the initializer to Sol instead",
    );
    expect(overview()).not.toContain("The trait comes from the");
  });

  it("selects the seat the file names, and the change it writes keeps the random value", async () => {
    withScript("enabled");
    await open("scenario");
    const html = overview();
    expect(html).toContain('<option value="enabled" selected="">Enabled</option>');
    expect(html).not.toContain('value="sol" selected=""');

    const system = useEditorStore.getState().inspected!.system;
    expect(scriptForKind("sol", system)).toEqual({
      paint_a_galaxy: { kind: "sol", random_value: 4 },
    });
  });

  it("turns the seat off through the script whatever the profile, and a plain system on through the weight", async () => {
    withScript("preferred");
    await open("scenario");
    const system = useEditorStore.getState().inspected!.system;
    for (const paint of [true, false]) {
      expect(spawnPointOp(system, null, paint || system.spawn_script !== null)).toEqual({
        type: "SetSpawnScript",
        id: SYSTEM,
        script: null,
      });
    }

    withWeight(null);
    await open("scenario");
    const plain = useEditorStore.getState().inspected!.system;
    expect(overview()).not.toContain('aria-label="Spawn kind"');
    expect(spawnPointOp(plain, DEFAULT_SPAWN_WEIGHT, false)).toEqual({
      type: "SetSpawnWeight",
      id: SYSTEM,
      base: 1,
    });
  });

  it("hides the vanilla reservation rows under the Paint a Galaxy layer, offering a seat instead", async () => {
    withWeight(3);
    await open("scenario");
    useFileSessionStore.setState({ painted: true });

    const html = overview();
    expect(html).not.toContain("Reserve for a human player");
    expect(html).not.toContain("Reserve for the AI");
    expect(html).toContain("Use a Paint a Galaxy seat");
    expect(html).toContain("The mod fills seats by kind and ignores this weight.");
  });

  it("writes the op that swaps a plain weight for an enabled Paint a Galaxy seat", async () => {
    withWeight(3);
    await open("scenario");
    useFileSessionStore.setState({ painted: true });
    const system = useEditorStore.getState().inspected!.system;

    await useEditorStore
      .getState()
      .applyOp({ type: "SetSpawnScript", id: system.id, script: enabledScript(system) });
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetSpawnScript",
      id: SYSTEM,
      script: { paint_a_galaxy: { kind: "enabled", random_value: SYSTEM % 10 } },
    });
  });
});

describe("the spawn point section", () => {
  it("leads the initializer it weighs, and is the file's own, not what the key places", async () => {
    await open("scenario");

    const html = overview();
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("basic_init_01"));
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("Choose"));
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("Hyperlanes"));
    expect(html).toContain('<span class="chip">scenario</span>');
  });

  it("leaves the initializer section open while nothing of the initializers draws", async () => {
    await open("scenario");
    useMapChromeStore.getState().toggleGroup("initializers");

    expect(sections(overview())).toContain("Initializer");
    expect(overview()).toContain("Choose");
  });
});

describe("a scenario system's prevented lanes", () => {
  // The lanes open closed on a scenario, so every test here opens the section first.
  beforeEach(() => {
    useInspectorStore.setState({ sections: { "system.hyperlanes": false } });
  });

  /** The pairs the projection reports, landed the way an op's delta lands them. */
  function preventing(ids: number[]): void {
    const system = useGalaxyStore.getState().systems.get(SYSTEM)!;
    useGalaxyStore.getState().applyDelta({ systems: [{ ...system, prevented: ids }] });
  }

  it("names each forbidden pair under the lanes, with the way to allow it and to add one", async () => {
    await open("scenario");
    preventing([3, 4]);

    const html = overview();
    expect(html).toContain("Prevented · 2");
    expect(html).toContain('title="Allow a lane between #1 and #3"');
    expect(html).toContain('title="Allow a lane between #1 and #4"');
    expect(html).toContain(">#3<");
    expect(html).toContain("Prevent lane to…");
    expect(html).toContain('aria-label="Prevent lane to id"');
    expect(html.indexOf("Hyperlanes · 4")).toBeLessThan(html.indexOf("Prevented · 2"));
  });

  it("sends the pair Allow clears and the one the id field forbids", async () => {
    await open("scenario");
    preventing([3]);

    await useEditorStore.getState().applyOp(unpreventLaneOp(SYSTEM, 3));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({ type: "UnpreventLane", a: SYSTEM, b: 3 });

    await useEditorStore.getState().applyOp(preventLaneOp(SYSTEM, 5));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({ type: "PreventLane", a: SYSTEM, b: 5 });
  });

  it("sends whatever whole number the field names and leaves the refusing to the core", () => {
    expect(preventTarget("5")).toBe(5);
    expect(preventTarget("")).toBeNull();
    expect(preventTarget("two")).toBeNull();
    expect(preventTarget("4.5")).toBeNull();
  });

  it("offers none of it on a save, whose lanes no scenario statement forbids", async () => {
    await open("save");
    await land(details());

    expect(overview()).not.toContain("Prevent lane to");
  });
});

/** The heads the Scripts section groups its rows under, in the order it writes them. */
function groups(html: string): string[] {
  return [...html.matchAll(/class="muted ins-spawn-head">([^<]*)</g)].map((m) => m[1]);
}

describe("a scenario system's scripts", () => {
  beforeEach(() => {
    useInspectorStore.setState({ tab: "scripts" });
  });

  it("sends the reader from the Overview's closed row to the tab that lists them", async () => {
    useInspectorStore.setState({ tab: "overview" });
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });

    const row = overview();
    expect(sections(row)).toContain("Scripts · 5");
    expect(row).toContain(SCRIPTS_TAB_TITLE);
    expect(row).toContain('<span class="chip src">scripts</span>');
    // The rows themselves are the tab's, not the Overview's.
    expect(row).not.toContain("empire_capital_init");
    expect(row).not.toContain(SCRIPTS_LIMITS);

    useInspectorStore.getState().setTab("scripts");
    const tab = overview();
    expect(sections(tab)).not.toContain("Scripts · 5");
    expect(tab).toContain("empire_capital_init");
    expect(tab).toContain(SCRIPTS_LIMITS);
  });

  it("shows the closed row's count as still reading, then unavailable once the read fails", async () => {
    useInspectorStore.setState({ tab: "overview" });
    await open("scenario");

    expect(sections(overview())).toContain("Scripts · …");

    useScriptsStore.setState({ failed: new Map([[SYSTEM, "no game data is loaded"]]) });
    const html = overview();
    expect(sections(html)).toContain("Scripts · unavailable");
    expect(html).toContain('class="ins-sec-title muted">Scripts · unavailable');
  });

  it("groups every kind the chain reaches and says when each runs and where it lives", async () => {
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });

    const html = overview();
    // The system's own initializer and the scenario effect are pinned above the groups.
    expect(groups(html).slice(-3)).toEqual(["Scripted effects", "Events", "On actions"]);
    expect(html.indexOf("empire_capital_init")).toBeLessThan(html.indexOf("Scripted effects"));
    expect(html).toContain("Fixture Capital");
    expect(html).toContain("at generation");
    expect(html).toContain("runs later");
    expect(html).toContain("timing unknown");
    expect(html).toContain("has_star_flag = fixture_beacon");
    expect(html).toContain("event_target:fixture_empire");
    expect(html).toContain("fired by on_game_start");
    expect(html).toContain("events/zz_fixture_events.txt:7");
    expect(html).toContain(SCRIPTS_LIMITS);
    expect(html).not.toContain("showing the first");

    expect(html).toContain('aria-label="Open zz_fixture_events.txt in editor"');
    expect(html).toContain('aria-label="Show zz_fixture_events.txt in Explorer"');
    // The scenario's own effect is a line of the document, not a game-data file to open.
    expect(html).toContain("my_galaxy.txt:41");
    expect(html).not.toContain("my_galaxy.txt in editor");
    expect(html).not.toContain("my_galaxy.txt in Explorer");
  });

  it("makes a script that names the system on several lines one row that opens onto them", async () => {
    await open("scenario");
    useScriptsStore.setState({ scripts: new Map([[SYSTEM, SYSTEM_SCRIPTS]]) });

    const html = overview();
    // One row for the script, counted, summarised by the ways in rather than by one line.
    expect(html.match(/>create_fixture_empire<\/span>/g)).toHaveLength(1);
    expect(html).toContain("×3");
    expect(html).toContain("call, has_star_flag · one");
    // Its three lines, each with its own phrase and its own way out to the file.
    expect(html).toContain(":3</span>");
    expect(html).toContain("called by the chain");
    expect(html).toContain("calls create_fixture_empire");
    expect(html).toContain("has_star_flag = fixture_core");
    expect(html.match(/aria-label="Open zz_countries.txt in editor"/g)).toHaveLength(4);
  });

  it("says so when the backend stopped at its row limit", async () => {
    await open("scenario");
    useScriptsStore.setState({
      scripts: new Map([[SYSTEM, { ...SYSTEM_SCRIPTS, truncated: true }]]),
    });

    expect(overview()).toContain("showing the first 200");
  });

  it("waits for the reading, says when nothing reaches the system, and reports a failure", async () => {
    await open("scenario");
    expect(overview()).toContain("Reading the scripts");

    useScriptsStore.setState({ missing: new Set([SYSTEM]) });
    expect(overview()).toContain("No scripts in the loaded game data reach this system.");

    useScriptsStore.setState({
      missing: new Set(),
      failed: new Map([[SYSTEM, "no game data is loaded"]]),
    });
    expect(overview()).toContain("The scripts could not be read: no game data is loaded");
  });

  it("asks for none of it on a save, whose systems carry no scripts", async () => {
    useInspectorStore.setState({ tab: "overview" });
    await open("save");
    expect(sections(overview())).not.toContain("Scripts · 0");
  });
});

/** What the game data says stands in `SYSTEM`, so the head and the initializer line have a kind. */
function landSpecial(): void {
  useGameDataStore.setState({
    special: new Map([
      [
        SYSTEM,
        {
          id: SYSTEM,
          primary: "unique",
          kinds: ["unique"],
          initializer: "basic_init_01",
          initializer_known: true,
          source_file: null,
          flags: [],
          countries: [],
          label: "Alpha Centauri",
        },
      ],
    ]),
  });
}

describe("the head of a scenario system", () => {
  it("carries no chip and no kind row, and says on the initializer line what stands here", async () => {
    landSpecial();
    await open("scenario");

    const html = overview();
    expect(html).not.toContain('class="ins-chips"');
    expect(html).not.toContain("The star class and what stands here");
    expect(html.indexOf("basic_init_01")).toBeLessThan(html.indexOf("Unique"));
    expect(html).toContain(kindTitle("unique"));
    // The chips that are left are the section headers' own.
    expect(html).toContain('class="ins-sec-title"');
  });

  it("renames the system from the head, so the Overview carries no Name section", async () => {
    landSpecial();
    await open("scenario");

    const html = overview();
    expect(html).toContain('title="Rename this system"');
    expect(sections(html)).not.toContain("Name");

    await useEditorStore.getState().applyOp(renameSystemOp(SYSTEM, "Sea of Ghosts"));

    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetSystemName",
      id: SYSTEM,
      name: "Sea of Ghosts",
    });
  });

  it("leaves a save's head as it was: plain name, kind chips, no source chip", async () => {
    landSpecial();
    await open("save");
    await land(details());

    const save = overview();
    expect(save).toContain('class="ins-chips"');
    expect(save).toContain(kindTitle("unique"));
    expect(save).not.toContain("Rename this system");
    expect(save).not.toContain("chip init");
    expect(save).not.toContain("chip src");
  });
});
