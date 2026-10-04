import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import { OPEN_RESULT, SCENARIO_RESULT, detailOf } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import { KIND_ORDER } from "../lib/special";
import { DEFAULT_LAYERS } from "../lib/visual/layerIds";
import {
  barKinds,
  barLayers,
  groupState,
  groupsFor,
  kindVisible,
  splitsBySource,
  type Source,
} from "../lib/visual/layerGroups";
import { useFileSessionStore } from "./fileSessionStore";
import { session } from "./sessionFixture";
import { armSession, resetStores } from "./storeFixture";
import { useGameDataStore } from "./gameDataStore";
import { useMapChromeStore } from "./mapChromeStore";

const chrome = () => useMapChromeStore.getState();
const onLayers = () =>
  Object.entries(chrome().layers)
    .filter(([, on]) => on)
    .map(([id]) => id);

const stored = new Map<string, string>();

beforeEach(() => {
  resetStores();
  stubPrefs(stored);
  armSession();
  mockedIpc.getSystem.mockImplementation(async (id) => detailOf(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layers", () => {
  it("starts with the map the game first shows and leviathans, enclaves and L-Gates", () => {
    expect(onLayers()).toEqual([
      "lanes",
      "owners",
      "bypasses",
      "systems",
      "classes",
      "heights",
      "special",
      "initializers",
      "spawns",
      "feZones",
      "marauders",
      "mapBorder",
      "lCluster",
      "labels",
      "details",
      "colonies",
      "watchlist",
      "highlights",
    ]);
    expect(KIND_ORDER.filter((kind) => chrome().shownKinds.has(kind))).toEqual([
      "leviathan",
      "enclave",
    ]);
  });

  it("a save opens on the galaxy map the game itself draws, with star classes, colonies and the two guides", async () => {
    await session().openSave(OPEN_RESULT.path);
    expect(onLayers()).toEqual([
      "nebulae",
      "lanes",
      "owners",
      "systems",
      "classes",
      "heights",
      "mapBorder",
      "lCluster",
      "labels",
      "details",
      "colonies",
      "watchlist",
      "highlights",
    ]);
  });

  it("a scenario opens on the overlays its own scripts fill", async () => {
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_RESULT.path);
    expect(chrome().layers).toEqual(DEFAULT_LAYERS);
  });

  it("an open leaves the layers the user set by hand where they are", async () => {
    chrome().toggleLayer("waylines");
    chrome().toggleLayer("labels");
    await session().openSave(OPEN_RESULT.path);
    expect(chrome().layers.waylines).toBe(true);
    expect(chrome().layers.labels).toBe(false);
    expect(chrome().layers.bypasses).toBe(false);
  });

  it("reset over a save puts the save's own layers back", async () => {
    await session().openSave(OPEN_RESULT.path);
    chrome().toggleLayer("bypasses");
    chrome().toggleLayer("labels");

    chrome().resetLayers();
    expect(chrome().layers.bypasses).toBe(false);
    expect(chrome().layers.classes).toBe(true);
    expect(chrome().layers.labels).toBe(true);
    expect(chrome().layers.nebulae).toBe(true);
  });

  it("a reset over a save leaves a scenario opening on its own layers", async () => {
    await session().openSave(OPEN_RESULT.path);
    chrome().resetLayers();

    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_RESULT.path);
    expect(chrome().layers).toEqual(DEFAULT_LAYERS);
  });

  it("toggles a layer and one point-of-interest kind, and resets both", () => {
    chrome().toggleLayer("bypasses");
    chrome().toggleLayer("labels");
    chrome().toggleKind("leviathan");
    chrome().toggleKind("landmark");
    expect(chrome().layers.bypasses).toBe(false);
    expect(chrome().layers.labels).toBe(false);
    expect(chrome().layers.lanes).toBe(true);
    expect(chrome().shownKinds.has("leviathan")).toBe(false);
    expect(chrome().shownKinds.has("landmark")).toBe(true);

    chrome().resetLayers();
    expect(chrome().layers.bypasses).toBe(true);
    expect(chrome().layers.labels).toBe(true);
    expect(chrome().shownKinds.has("leviathan")).toBe(true);
    expect(chrome().shownKinds.has("landmark")).toBe(false);
  });

  it("the points-of-interest toggle shows every kind, then hides them all", () => {
    chrome().toggleAllKinds();
    expect(chrome().shownKinds.size).toBe(KIND_ORDER.length);
    chrome().toggleAllKinds();
    expect(chrome().shownKinds.size).toBe(0);
    chrome().toggleAllKinds();
    expect(chrome().shownKinds.size).toBe(KIND_ORDER.length);
  });

  it("shows the kinds in the order the open document counts them in", () => {
    const reversed = [...KIND_ORDER].reverse();
    useGameDataStore.setState({
      counts: reversed.map((kind) => ({ kind, count: 1, primary_count: 1 })),
    });
    chrome().toggleAllKinds();
    expect([...chrome().shownKinds]).toEqual(reversed);
  });

  it("setLayerQuietly turns a layer on and leaves one that is already on alone", () => {
    chrome().setLayerQuietly("nebulae", true);
    expect(chrome().layers.nebulae).toBe(true);

    const layers = chrome().layers;
    chrome().setLayerQuietly("nebulae", true);
    expect(chrome().layers).toBe(layers);
  });

  it("number keys 1-9 toggle the six plain layers, then points of interest, nebulae and issues", () => {
    chrome().toggleLayerKey(0);
    expect(chrome().layers.lanes).toBe(false);

    chrome().toggleLayerKey(6);
    expect(chrome().shownKinds.size).toBe(KIND_ORDER.length);

    chrome().toggleLayerKey(7);
    expect(chrome().layers.nebulae).toBe(true);
    chrome().toggleLayerKey(8);
    expect(chrome().layers.issues).toBe(true);

    chrome().toggleLayerKey(9);
    expect(chrome().layers.issues).toBe(true);
  });

  it("the status bar's gesture is published once and dropped with the other overlays", () => {
    expect(chrome().gesture).toBeNull();
    chrome().setGesture("lane");
    expect(chrome().gesture).toBe("lane");
    chrome().setGesture("connecting");
    expect(chrome().gesture).toBe("connecting");
    chrome().clearOverlays();
    expect(chrome().gesture).toBeNull();
  });
});

describe("group toggles", () => {
  const initializers = groupsFor("scenario").find((group) => group.source === "initializers");
  /** The layers the button stands over: the icons the bar carries, not the whole menu. */
  const barOf = () => (initializers ? barLayers(initializers) : []);
  /** The kinds the bar gives that group a button of its own. */
  const kindsOf = () => (initializers ? barKinds(initializers) : []);
  const stateOf = (source: Source) => groupState(chrome(), "scenario", source);

  beforeEach(() => {
    useFileSessionStore.setState({ kind: "scenario" });
  });

  it("the group all on turns every icon of it off, and leaves the file's own alone", () => {
    chrome().toggleKind("landmark");
    expect(stateOf("initializers")).toBe("on");

    chrome().toggleGroup("initializers");
    expect(stateOf("initializers")).toBe("off");
    for (const id of barOf()) expect(chrome().layers[id]).toBe(false);
    expect(chrome().layers.lanes).toBe(true);
    expect(chrome().layers.systems).toBe(true);
    expect(chrome().layers.labels).toBe(true);
    // The bar's own kinds go with it; the kinds only the menu lists stay as they are.
    for (const kind of kindsOf()) expect(chrome().shownKinds.has(kind)).toBe(false);
    expect(chrome().shownKinds.has("landmark")).toBe(true);
    expect(chrome().layers.special).toBe(true);
  });

  it("leaves the layers only the menu carries as they are", () => {
    chrome().toggleGroup("initializers");
    expect(chrome().layers.classes).toBe(true);
    expect(chrome().layers.colonies).toBe(true);
    expect(barOf()).not.toContain("classes");
    expect(barOf()).not.toContain("colonies");

    // A menu layer off is not the group half drawn, either.
    chrome().toggleLayer("classes");
    expect(stateOf("initializers")).toBe("off");
  });

  it("a group part on turns all of it off", () => {
    chrome().toggleLayer("details");
    expect(stateOf("initializers")).toBe("mixed");

    chrome().toggleGroup("initializers");
    expect(stateOf("initializers")).toBe("off");
    for (const id of barOf()) expect(chrome().layers[id]).toBe(false);
  });

  it("the group off turns every icon of it back on", () => {
    chrome().toggleGroup("initializers");

    chrome().toggleGroup("initializers");
    for (const id of barOf()) expect(chrome().layers[id]).toBe(true);
    expect(stateOf("initializers")).toBe("on");
  });

  it("the group filled from off shows the bar's kinds and leaves the others", () => {
    chrome().toggleAllKinds();
    chrome().toggleAllKinds();
    chrome().toggleLayer("special");
    expect(chrome().shownKinds.size).toBe(0);

    chrome().toggleGroup("initializers");
    expect(stateOf("initializers")).toBe("off");

    chrome().toggleGroup("initializers");
    expect(chrome().layers.special).toBe(true);
    expect([...chrome().shownKinds]).toEqual([...kindsOf()]);
    expect(chrome().shownKinds.size).toBeLessThan(KIND_ORDER.length);
  });

  it("remembers nothing: one layer on by hand is the only one the group shows", () => {
    chrome().toggleGroup("initializers");

    chrome().toggleLayer("details");
    expect(chrome().layers.details).toBe(true);
    expect(chrome().layers.owners).toBe(false);
    expect(stateOf("initializers")).toBe("mixed");

    // The press hides what is left rather than putting back what the group once hid.
    chrome().toggleGroup("initializers");
    expect(chrome().layers.details).toBe(false);

    chrome().toggleGroup("initializers");
    for (const id of barOf()) expect(chrome().layers[id]).toBe(true);
  });

  it("each group switches its own layers and no others", () => {
    expect(stateOf("scripts")).toBe("off");
    chrome().toggleGroup("scripts");
    expect(chrome().layers.claims).toBe(true);
    expect(chrome().layers.day_one_bypasses).toBe(true);
    expect(stateOf("scripts")).toBe("on");
    expect(stateOf("initializers")).toBe("on");

    chrome().toggleGroup("scripts");
    expect(chrome().layers.claims).toBe(false);
    expect(chrome().layers.day_one_bypasses).toBe(false);
    expect(chrome().layers.owners).toBe(true);
    expect(stateOf("scripts")).toBe("off");
    expect(stateOf("initializers")).toBe("on");
  });

  it("a kind shown by hand brings back the layer that carries it, and nothing else", () => {
    chrome().toggleGroup("initializers");

    chrome().toggleKind("leviathan");
    expect(chrome().layers.special).toBe(true);
    expect(kindVisible(chrome(), "leviathan")).toBe(true);
    expect(chrome().layers.details).toBe(false);
    expect(stateOf("initializers")).toBe("mixed");
  });

  it("the scenario's own layers have no button over them", () => {
    chrome().toggleGroup("scenario");
    expect(chrome().layers.lanes).toBe(true);
    expect(chrome().layers.systems).toBe(true);
  });

  it("reset puts every layer and kind back, whatever the group buttons did", () => {
    chrome().toggleGroup("initializers");

    chrome().resetLayers();
    expect(chrome().layers.owners).toBe(true);
    expect(chrome().layers.details).toBe(true);
    expect([...chrome().shownKinds]).toEqual(["leviathan", "enclave"]);
  });

  it("a save is split by nothing, so it carries no group button at all", async () => {
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_RESULT.path);
    expect(splitsBySource(session().kind)).toBe(true);

    await session().openSave(OPEN_RESULT.path);
    expect(splitsBySource(session().kind)).toBe(false);
    expect(groupsFor(session().kind).every((group) => !group.master)).toBe(true);

    chrome().toggleGroup("scenario");
    expect(chrome().layers.lanes).toBe(true);
    expect(chrome().layers.owners).toBe(true);
  });
});

describe("the day-one claims", () => {
  it("the claims on show the empires they draw inside, and off leave them as they are", () => {
    chrome().toggleLayer("owners");
    expect(chrome().layers.claims).toBe(false);

    chrome().toggleLayer("claims");
    expect(chrome().layers.claims).toBe(true);
    expect(chrome().layers.owners).toBe(true);

    chrome().toggleLayer("claims");
    expect(chrome().layers.claims).toBe(false);
    expect(chrome().layers.owners).toBe(true);
  });

  it("the empires off take the claims with them, and on leave them as they are", () => {
    chrome().toggleLayer("owners");
    expect(chrome().layers.claims).toBe(false);

    chrome().toggleLayer("owners");
    expect(chrome().layers.owners).toBe(true);
    expect(chrome().layers.claims).toBe(false);
  });

  it("the scripts group on shows the empires its claims need", () => {
    useFileSessionStore.setState({ kind: "scenario" });
    chrome().toggleLayer("owners");
    expect(chrome().layers.owners).toBe(false);

    chrome().toggleGroup("scripts");
    expect(chrome().layers.claims).toBe(true);
    expect(chrome().layers.owners).toBe(true);
  });

  it("the initializers group off takes the claims with the empires it hides", () => {
    useFileSessionStore.setState({ kind: "scenario" });
    chrome().toggleGroup("scripts");
    expect(chrome().layers.claims).toBe(true);

    chrome().toggleGroup("initializers");
    expect(chrome().layers.owners).toBe(false);
    expect(chrome().layers.claims).toBe(false);
    expect(chrome().layers.day_one_bypasses).toBe(true);
  });
});
