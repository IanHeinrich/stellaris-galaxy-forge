import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { editResult } from "../../../store/fixture";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { SAVE_CAPABILITIES } from "../../../lib/capabilities";
import { open, resetStores } from "../inspectorFixture";
import { drawnBy, drawnButton } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { WORLD, EMPIRE, EMPIRE_NODE, landPage, render, OLBERS } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("a planet's anomaly", () => {
  it("names the anomaly waiting on it and who found it where it cannot be edited", async () => {
    await open("save");
    useFileSessionStore.setState({ capabilities: { ...SAVE_CAPABILITIES, anomalies: false } });
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [EMPIRE] } });

    const html = render(WORLD);
    expect(html).toMatch(/<span class="k">Anomaly<\/span><span>time_loop_world/);
    expect(html).toContain("found by Ti Zru Conservers");
    expect(html).not.toContain("Remove time_loop_world");
  });

  const TIME_LOOP = {
    key: "time_loop_world",
    name: "Time Loop",
    level: 8,
    description: "The planet repeats the same day.",
    usual: false,
  };

  it("draws an editable anomaly once, in its section, with who found it and the game's description", async () => {
    useGameDataStore.setState({ status: "ready" });
    await open("save");
    useGalaxyStore.setState({ countries: new Map([[EMPIRE, EMPIRE_NODE]]) });
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [EMPIRE] } });
    usePlanetDataStore.setState({ anomalies: new Map([[TIME_LOOP.key, TIME_LOOP]]) });

    const html = render(WORLD);
    expect(html).not.toMatch(/<span class="k">Anomaly<\/span>/);
    expect(html.match(/found by Ti Zru Conservers/g)).toHaveLength(1);
    expect(html).toContain('<span class="pl-anomaly-desc">The planet repeats the same day.</span>');
    expect(html.indexOf("Remove time_loop_world")).toBeLessThan(html.indexOf("About"));
  });

  it("shows no description without game data", async () => {
    useGameDataStore.setState({ status: "idle" });
    await open("save");
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [] } });

    const html = render(WORLD);
    expect(html).toContain("not found yet");
    expect(html).not.toContain("pl-anomaly-desc");
  });

  it("offers a remove button on its anomaly, and no picker while it has one", async () => {
    await open("save");
    await landPage({ ...OLBERS, anomaly: { category: "time_loop_world", found_by: [] } });

    const html = drawnBy(() => render(WORLD));
    expect(html).toContain("Anomaly");
    expect(html).toContain("not found yet");
    expect(html).not.toContain("+ Add anomaly…");

    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnButton("Remove time_loop_world").onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({ type: "RemoveAnomaly", body: WORLD });
  });

  it("offers a picker to add an anomaly when it has none", async () => {
    await open("save");
    await landPage(OLBERS);

    const html = render(WORLD);
    expect(html).toContain("+ Add anomaly…");
    expect(html.indexOf("+ Add modifier…")).toBeLessThan(html.indexOf("+ Add anomaly…"));
    expect(html.indexOf("+ Add anomaly…")).toBeLessThan(html.indexOf("About"));
  });
});
