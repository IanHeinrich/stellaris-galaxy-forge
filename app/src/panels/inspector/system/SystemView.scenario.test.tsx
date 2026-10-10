import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAY_ONE_OWNER,
  DAY_ONE_TERRITORY,
  SCENARIO_BYPASSES,
  SCENARIO_OWNERS,
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
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { kindTitle } from "../../../lib/special";
import { DETAILS_DEBOUNCE_MS } from "../../../store/batching";
import { bindStores } from "../../../store/bindStores";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { addrKey, useEntityStore, viewKey } from "../../../store/entityStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import {
  details,
  land,
  open,
  overview,
  planet,
  resetStores,
  sections,
  SYSTEM,
} from "../inspectorFixture";
import { PREVENT_HINT } from "./sections/Hyperlanes";
import { drawnBy, drawnButton, drawnField } from "../../../test/drawn";
import { TextField } from "../../EditField";
import { SystemView } from "./SystemView";
import { mockedIpc } from "../../../test/ipc";

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
      "Spawn point",
      "Planets · 2 · 0 colonies",
      "Station",
      "Megastructures · 1",
      "Initializer",
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
    // A scenario's bodies open their own page; its station and megastructures have none.
    expect(html).toContain('class="ins-prow" role="button"');
    expect(html).toContain('class="ins-prow static"');
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
      "Spawn point",
      "Resources · 2",
      "Initializer",
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
    expect(sections(html)).toEqual(["Spawn point", "Initializer", "Hyperlanes · 4", "Scripts · …"]);
    expect(html).toContain("Kepler");
    expect(html).not.toContain("System total");
    expect(html).not.toContain("Reading the system");
  });
});

/** Answers `getSystem` with the fixture's detail, but `id`'s system stamped with `owner`. */
function ownerDetail(id: number, owner: number): void {
  mockedIpc.getSystem.mockImplementation(async (reqId) => {
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
    expect(dayOne).toContain('title="The owner is the one an event claims');

    ownerDetail(1, TERRITORY.id);
    await open("scenario");
    useGameDataStore.setState({ scenarioOwners: SCENARIO_OWNERS });

    const generation = overview();
    expect(generation).toContain('title="The owner is the one the initializer');
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
    expect(html).toContain('title="Placed by the initializer');
  });

  it("marks a day-one endpoint with the scripts that place it, and says when it is assumed", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });
    await useEditorStore.getState().select(0);

    const html = renderToStaticMarkup(<SystemView id={0} />);
    expect(html).toContain("Gateway (ruined)");
    expect(html).toContain('title="Placed on day one by fixture.9"');
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
    mockedIpc.getSystemDetails.mockRejectedValue({ kind: "no_session", message: "nothing open" });

    useDetailsStore.getState().request([SYSTEM]);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);

    const html = overview();
    expect(html).toContain("The contents could not be read: nothing open");
    expect(html).not.toContain("Reading the system");
  });

  it("reads them again once an edit invalidates the failure", async () => {
    await open("scenario");
    useInspectorStore.setState({ tab: "contents" });
    mockedIpc.getSystemDetails.mockRejectedValueOnce({
      kind: "no_session",
      message: "nothing open",
    });
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
  it("reads the system's own text", async () => {
    await open("scenario");
    landEntity();

    useInspectorStore.setState({ tab: "source" });
    const source = overview();
    expect(source).toContain("id=1");
    expect(source).not.toContain("no text of their own");
  });

  it("waits for the entity rather than showing text of its own", async () => {
    await open("scenario");
    useInspectorStore.setState({ tab: "source" });

    expect(overview()).toContain("Reading the system");
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

  it("names each forbidden pair under the lanes, with the way to allow it and where to add one", async () => {
    await open("scenario");
    preventing([3, 4]);

    const html = overview();
    expect(html).toContain("Prevented · 2");
    expect(html).toContain('title="Allow a lane between #1 and #3"');
    expect(html).toContain('title="Allow a lane between #1 and #4"');
    expect(html).toContain(">#3<");
    expect(html).toContain(PREVENT_HINT);
    expect(html).not.toContain("Prevent lane to");
    expect(html.indexOf("Hyperlanes · 4")).toBeLessThan(html.indexOf("Prevented · 2"));
  });

  it("sends the pair Allow clears", async () => {
    await open("scenario");
    preventing([3]);
    drawnBy(overview);
    drawnButton("Allow a lane between #1 and #3").onClick();

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "AllowLane",
      a: SYSTEM,
      b: 3,
    });
  });

  it("offers none of it on a save, whose lanes no scenario statement forbids", async () => {
    await open("save");
    await land(details());

    const html = overview();
    expect(sections(html)).toContain("Hyperlanes · 4");
    expect(html).not.toContain(PREVENT_HINT);
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
          label_is_generated_name: false,
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

  it("says a system with no name gets a random one from the game", async () => {
    await open("scenario");
    const inspected = useEditorStore.getState().inspected!;
    useEditorStore.setState({
      inspected: {
        ...inspected,
        system: { ...inspected.system, name: { key: "", literal: false, variables: [] } },
      },
    });

    const html = overview();
    expect(html).toContain('placeholder="Random name"');
    expect(html).toContain("No name. Stellaris picks a random one when the game starts.");
  });

  it("renames the system from the head, so the Overview carries no Name section", async () => {
    landSpecial();
    await open("scenario");

    const html = drawnBy(overview);
    expect(html).toContain('title="Rename this system"');
    expect(html).toContain('aria-label="System name"');
    expect(sections(html)).not.toContain("Name");

    const name = drawnField(TextField, "System name") as { onCommit(name: string): void };
    name.onCommit("Sea of Ghosts");

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "RenameSystem",
      system: SYSTEM,
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

describe("a Paint a Galaxy scenario system's wormhole pair", () => {
  /** Opens the scenario under the Paint a Galaxy layer with `paired` given wormhole pair 2. */
  async function openPaired(paired: number[]): Promise<void> {
    await open("scenario");
    useFileSessionStore.setState({ painted: true });
    const systems = new Map(useGalaxyStore.getState().systems);
    for (const id of paired) systems.set(id, { ...systems.get(id)!, wormhole_pair: 2 });
    useGalaxyStore.setState({ systems });
  }

  it("names the pair and its other end, and says how the mod opens it", async () => {
    await openPaired([SYSTEM, 3]);

    const html = overview();
    expect(sections(html)).toContain("Wormhole pair");
    expect(html).toContain("Wormhole pair 2 with ");
    expect(html).toContain("Sirius");
    expect(html).toContain("The Paint a Galaxy mod opens a wormhole");
  });

  it("says when the file names no other end", async () => {
    await openPaired([SYSTEM]);

    const html = overview();
    expect(sections(html)).toContain("Wormhole pair");
    expect(html).toContain("Wormhole pair 2, partner missing");
  });
});
