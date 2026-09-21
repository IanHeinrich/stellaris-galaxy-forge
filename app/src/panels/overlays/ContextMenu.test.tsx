import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { onProgress } from "../../api/events";
import * as ipc from "../../api/ipc";
import { bindStores } from "../../store/bindStores";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { OPEN_RESULT, SCENARIO_RESULT, node } from "../../store/fixture";
import { newFeZone } from "../../lib/feZone";
import { ContextMenu } from "./ContextMenu";

bindStores();

const menu = () => renderToStaticMarkup(<ContextMenu />);

beforeEach(async () => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  vi.mocked(onProgress).mockResolvedValue(() => undefined);
  vi.mocked(ipc.openSave).mockResolvedValue(OPEN_RESULT);
  await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
});

describe("a lane's context menu", () => {
  it("offers Cut for a lane whose systems are both in the galaxy", () => {
    useMapChromeStore
      .getState()
      .openContextMenu({ target: { kind: "lane", lane: { a: 0, b: 1 } }, x: 0, y: 0 });

    const html = menu();
    expect(html).toContain(">Cut</button>");
    expect(html).not.toContain("disabled=");
    expect(html).not.toContain("no longer in the galaxy");
  });

  it("refuses Cut once a delta has taken one of the lane's systems away, and says why", () => {
    useGalaxyStore.getState().applyDelta({ systems: [], removed: [1] });
    useMapChromeStore
      .getState()
      .openContextMenu({ target: { kind: "lane", lane: { a: 0, b: 1 } }, x: 0, y: 0 });

    const html = menu();
    expect(html).toContain("disabled=");
    expect(html).toContain("One of this lane&#x27;s systems is no longer in the galaxy.");
  });
});

describe("a scenario system's spawn point item", () => {
  /** A scenario whose one system names no initializer. */
  async function openEmptySystem(): Promise<void> {
    const empty = node(0, "NAME_Sol", 0, 0, "sc_g", [], { initializer: "" });
    vi.mocked(ipc.openSave).mockResolvedValue({
      ...SCENARIO_RESULT,
      galaxy: { ...SCENARIO_RESULT.galaxy, systems: [empty] },
    });
    await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
  }

  it("refuses a system without an initializer, and says why", async () => {
    await openEmptySystem();

    const html = menu();
    const item = html.match(/<button[^>]*>Set as spawn point<\/button>/)![0];
    expect(item).toContain("disabled=");
    expect(item).toContain("choose one first");
  });

  it("takes it under the Paint a Galaxy profile, whose op supplies the initializer", async () => {
    await openEmptySystem();
    useFileSessionStore.setState({ painted: true });

    const html = menu();
    const item = html.match(/<button[^>]*>Set as spawn point<\/button>/)![0];
    expect(item).not.toContain("disabled=");
    expect(item).not.toContain("choose one first");
  });
});

describe("the fallen empire zone items", () => {
  /** The fixture galaxy as a Paint a Galaxy scenario, Sol anchoring a zone west at 40. */
  async function openPainted(): Promise<void> {
    const sol = { ...SCENARIO_RESULT.galaxy.systems[0], fe_zone: newFeZone("w") };
    vi.mocked(ipc.openSave).mockResolvedValue({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        systems: [sol, ...SCENARIO_RESULT.galaxy.systems.slice(1)],
      },
    });
    await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  }

  it("are offered on a system, on empty space and on a ring only under the Paint a Galaxy layer", async () => {
    await openPainted();
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "system", id: 3 }, x: 0, y: 0 });
    expect(menu()).toContain(">Add fallen empire zone</button>");
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    expect(menu()).toContain(">Add fallen empire zone, anchored to ");
    expect(menu()).toContain(">Fit fallen empire zones…</button>");
    chrome.openContextMenu({ target: { kind: "feZone", anchor: 0 }, x: 0, y: 0 });
    expect(menu()).toContain(">Remove fallen empire zone</button>");
    expect(menu()).toContain(">Select Sol</button>");

    useFileSessionStore.setState({ painted: false });
    chrome.openContextMenu({ target: { kind: "system", id: 3 }, x: 0, y: 0 });
    expect(menu()).not.toContain("fallen empire zone");
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    expect(menu()).not.toContain("allen empire zone");
  });

  it("refuses a second zone on an anchor, and says so", async () => {
    await openPainted();
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    const item = menu().match(/<button[^>]*>Add fallen empire zone<\/button>/)![0];
    expect(item).toContain("disabled=");
    expect(item).toContain("This system already anchors a zone");
  });
});

describe("the marauder clan items", () => {
  /** The fixture galaxy as a Paint a Galaxy scenario, with the given systems as clan homes. */
  async function openWithHomes(homes: Record<number, number>): Promise<void> {
    vi.mocked(ipc.openSave).mockResolvedValue({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        systems: SCENARIO_RESULT.galaxy.systems.map((s) =>
          s.id in homes
            ? { ...s, initializer: `marauder_${homes[s.id]}_1`, marauder: { home: homes[s.id] } }
            : s,
        ),
      },
    });
    await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  }

  it("adds the next free clan on empty space, and names it on a system's menu, only under the layer", async () => {
    await openWithHomes({ 0: 1 });
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    const space = menu().match(/<button[^>]*>Add marauder clan here<\/button>/)![0];
    expect(space).not.toContain("disabled=");
    chrome.openContextMenu({ target: { kind: "system", id: 3 }, x: 0, y: 0 });
    expect(menu()).toContain(">Make this the marauder clan 2 home</button>");

    useFileSessionStore.setState({ painted: false });
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    expect(menu()).not.toContain("marauder clan");
    chrome.openContextMenu({ target: { kind: "system", id: 3 }, x: 0, y: 0 });
    expect(menu()).not.toContain("marauder clan");
  });

  it("offers to remove the clan on a home, and the base on a raid base, in the home item's place", async () => {
    await openWithHomes({ 0: 1 });
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    let html = menu();
    expect(html).toContain(">Remove marauder clan 1</button>");
    expect(html).not.toContain("Make this the marauder clan");

    const systems = new Map(useGalaxyStore.getState().systems);
    systems.set(2, { ...systems.get(2)!, initializer: "marauder_1_2", marauder: { base: 1 } });
    useGalaxyStore.setState({ systems });
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 2 }, x: 0, y: 0 });
    html = menu();
    expect(html).toContain(">Remove marauder raid base</button>");
    expect(html).not.toContain("Make this the marauder clan");

    useFileSessionStore.setState({ painted: false });
    expect(menu()).not.toContain("marauder");
  });

  it("disables the empty-space item and hides the system item once all three clans are placed", async () => {
    await openWithHomes({ 0: 1, 1: 2, 2: 3 });
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    const space = menu().match(/<button[^>]*>Add marauder clan here<\/button>/)![0];
    expect(space).toContain("disabled=");
    expect(space).toContain('title="All three clans are placed"');
    chrome.openContextMenu({ target: { kind: "system", id: 3 }, x: 0, y: 0 });
    expect(menu()).not.toContain("marauder clan");
  });
});
