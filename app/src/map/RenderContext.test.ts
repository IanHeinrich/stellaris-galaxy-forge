import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_RESULT, SCENARIO_BYPASSES, SCENARIO_RESULT } from "../store/fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { useFileSessionStore } from "../store/fileSessionStore";
import { useGalaxyStore } from "../store/galaxyStore";
import { useGameDataStore } from "../store/gameDataStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import { renderContext } from "./RenderContext";

/** Opens the fixture galaxy as one kind of document, with the game data's bypasses in hand. */
function open(result: typeof OPEN_RESULT): void {
  useGalaxyStore.getState().load(result.galaxy);
  useFileSessionStore.setState({
    status: "ready",
    kind: result.kind,
    capabilities: result.capabilities,
  });
}

function shown(initializers: boolean, dayOne: boolean): void {
  useMapChromeStore.setState({
    layers: {
      ...useMapChromeStore.getState().layers,
      bypasses: initializers,
      day_one_bypasses: dayOne,
    },
  });
}

beforeEach(() => {
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("a scenario's bypasses in the render context", () => {
  beforeEach(() => {
    open(SCENARIO_RESULT);
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });
  });

  it("draws a pair once, lower id first, and a lone endpoint where it stands", () => {
    shown(true, true);

    expect(renderContext().bypasses).toEqual([
      { type: "wormhole", a: 1, b: 2 },
      { type: "gateway", system: 0, active: false },
      { type: "other", system: 5, kind: "wormhole" },
    ]);
  });

  it("gives each source its own toggle", () => {
    shown(true, false);
    expect(renderContext().bypasses).toEqual([{ type: "wormhole", a: 1, b: 2 }]);

    shown(false, true);
    expect(renderContext().bypasses).toEqual([
      { type: "gateway", system: 0, active: false },
      { type: "other", system: 5, kind: "wormhole" },
    ]);

    shown(false, false);
    expect(renderContext().bypasses).toEqual([]);
  });

  it("hands out the same instance until the reading or a toggle changes", () => {
    shown(true, true);
    const links = renderContext().bypasses;
    expect(renderContext().bypasses).toBe(links);

    shown(true, false);
    expect(renderContext().bypasses).not.toBe(links);
  });

  it("draws nothing until the game data has been read", () => {
    useGameDataStore.setState({ scenarioBypasses: null });
    shown(true, true);

    expect(renderContext().bypasses).toEqual([]);
  });
});

describe("a save's bypasses in the render context", () => {
  it("draws what the file itself states, whatever a scenario's toggles say", () => {
    open(OPEN_RESULT);
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });
    shown(false, false);

    expect(renderContext().bypasses).toEqual(OPEN_RESULT.galaxy.bypasses);
  });
});

describe("a save's waystations in the render context", () => {
  const station = { system: 4, starbase: 9, network: 1 };
  const line = { a: 4, b: 5, network: 1 };

  function openWith(waystations: Array<typeof station>, waylines: Array<typeof line>): void {
    open({ ...OPEN_RESULT, galaxy: { ...OPEN_RESULT.galaxy, waystations, waylines } });
  }

  it("keys the stations by system and hands out the same map until the save's list changes", () => {
    openWith([station], [line]);

    const stations = renderContext().waystations;
    expect(renderContext().waylines).toEqual([line]);
    expect(stations.get(4)).toEqual(station);
    expect(renderContext().waystations).toBe(stations);

    openWith([], []);
    expect(renderContext().waystations).not.toBe(stations);
    expect(renderContext().waystations.size).toBe(0);
  });
});
