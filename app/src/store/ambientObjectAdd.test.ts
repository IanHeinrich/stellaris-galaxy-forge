import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { AMBIENT_OBJECTS_NEED_GAME_DATA } from "../lib/ambientObjectAdd";
import { mainStarPoint } from "../lib/details/ambientObjects";
import { ambientObjectView, offCentreMainStar } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { inSystem } from "../test/session";
import { useAmbientObjectAddStore } from "./ambientObjectAdd";
import { openFixtureScenario, sessionError } from "./editorFixture";
import { editResult, orbitClasses } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useMapChromeStore } from "./mapChromeStore";
import { systemGeometry } from "./systemGeometry";

const SYSTEM = 0;
const CREATED = 0x6000_0001;
const adds = () => useAmbientObjectAddStore.getState();

beforeEach(async () => {
  vi.clearAllMocks();
  await openFixtureScenario();
  inSystem(offCentreMainStar({ id: SYSTEM }));
  useAmbientObjectAddStore.setState({ prompt: null, last: null });
  const derelict = ambientObjectView("derelict_ship_object", { name: "Derelict Ship" });
  useGameDataStore.setState({
    status: "ready",
    planetClasses: orbitClasses(),
    ambientObjects: new Map([[derelict.key, derelict]]),
  });
  useMapChromeStore.setState({
    sceneLayers: { ...useMapChromeStore.getState().sceneLayers, megastructures: false },
  });
  mockedIpc.addAmbientObject.mockResolvedValue({
    edit: editResult({ details_stale: [SYSTEM] }),
    planets: [],
    megastructures: [],
    ambient_objects: [CREATED],
  });
});

describe("adding an ambient object", () => {
  it("needs game data to open", () => {
    useGameDataStore.setState({ status: "idle" });
    expect(adds().open(SYSTEM, 10, 10)).toBe(false);
    expect(adds().prompt).toBeNull();
    expect(sessionError()).toBe(AMBIENT_OBJECTS_NEED_GAME_DATA);
  });

  it("sends the point pressed measured from an off-centre main star, and opens the new object's page", async () => {
    const { frame } = systemGeometry(SYSTEM);
    const star = mainStarPoint(frame.layout, frame.details);
    expect(Math.hypot(star.x, star.y), "the main star stands off the centre").toBeGreaterThan(0);
    adds().open(SYSTEM, 120, 40);
    expect(adds().prompt).toEqual({ system: SYSTEM, x: 120, y: 40 });
    expect(await adds().add("derelict_ship_object")).toBe(true);

    const [system, kind, x, y] = mockedIpc.addAmbientObject.mock.calls[0];
    expect([system, kind]).toEqual([SYSTEM, "derelict_ship_object"]);
    expect([x, y]).toEqual([expect.closeTo(120 - star.x), expect.closeTo(40 - star.y)]);
    expect(adds().prompt).toBeNull();
    const top = useInspectorStore.getState().stack.at(-1);
    expect(top).toMatchObject({
      ref: { kind: "ambient_object", system: SYSTEM, id: CREATED },
      label: "Derelict Ship",
    });
    expect(useMapChromeStore.getState().sceneLayers.megastructures, "it shows").toBe(true);
  });

  it("opens no page when the core refuses the add", async () => {
    mockedIpc.addAmbientObject.mockRejectedValue(new Error("refused"));
    adds().open(SYSTEM, 120, 40);
    expect(await adds().add("derelict_ship_object")).toBe(false);
    expect(useInspectorStore.getState().stack.at(-1)?.ref.kind).not.toBe("ambient_object");
    expect(useMapChromeStore.getState().sceneLayers.megastructures).toBe(false);
  });
});
