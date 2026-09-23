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
import { OPEN_RESULT, SCENARIO_RESULT, detailOf, node } from "../../store/fixture";
import type { MarauderRole } from "../../generated/MarauderRole";
import { newFeZone } from "../../lib/feZone";
import { clanOf } from "../../lib/marauder";
import { useEditorStore } from "../../store/editorStore";
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
    expect(html).not.toContain("Cut and prevent");
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

describe("a scenario's prevented pairs", () => {
  beforeEach(async () => {
    vi.mocked(ipc.openSave).mockResolvedValue(SCENARIO_RESULT);
    await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  });

  it("are made from a lane's menu and a system's, counting the selected systems each covers", () => {
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "lane", lane: { a: 0, b: 1 } }, x: 0, y: 0 });
    expect(menu()).toContain(">Cut and prevent</button>");

    const sirius = useGalaxyStore.getState().systems.get(3)!;
    useGalaxyStore.getState().applyDelta({ systems: [{ ...sirius, prevented: [1] }] });
    useEditorStore.setState({ selection: [2, 3] });
    chrome.openContextMenu({ target: { kind: "system", id: 1 }, x: 0, y: 0 });
    const html = menu();
    expect(html).toContain("Prevent lanes to selected (1)");
    expect(html).toContain("Allow lanes to selected (1)");
    expect(html.indexOf("Cut hyperlanes to selected")).toBeLessThan(
      html.indexOf("Prevent lanes to selected"),
    );
  });

  it("are allowed again from the menu on a prevented dash, which names both systems", () => {
    useMapChromeStore
      .getState()
      .openContextMenu({ target: { kind: "prevented", a: 0, b: 1 }, x: 0, y: 0 });

    const html = menu();
    expect(html).toContain("Sol — Alpha Centauri");
    expect(html).toContain(">Allow</button>");
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

describe("the fallen empire link items", () => {
  /**
   * The fixture galaxy as a Paint a Galaxy scenario: Sol anchoring a zone west at 40 that takes
   * custom connections under id 1 when `custom`, and Deneb linked to that id.
   */
  async function openLinked(custom: boolean): Promise<void> {
    const [sol, ...rest] = SCENARIO_RESULT.galaxy.systems;
    const systems = [
      {
        ...sol,
        fe_zone: newFeZone("w"),
        fe_link: { custom, id: custom ? 1 : null, to: [] },
      },
      ...rest.map((s) =>
        s.id === 5 ? { ...s, fe_link: { custom: false, id: null, to: [1] } } : s,
      ),
    ];
    vi.mocked(ipc.openSave).mockResolvedValue({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: { ...SCENARIO_RESULT.galaxy, systems },
    });
    await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
    vi.mocked(ipc.getSystem).mockImplementation(async (id) => detailOf(id));
  }

  const on = (id: number) =>
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id }, x: 0, y: 0 });
  const onRing = (anchor: number) =>
    useMapChromeStore
      .getState()
      .openContextMenu({ target: { kind: "feZone", anchor }, x: 0, y: 0 });

  it("offers a link or an unlink on a system while one selected system anchors a zone", async () => {
    await openLinked(true);
    const editor = useEditorStore.getState();
    on(3);
    expect(menu()).not.toContain("&#x27;s fallen empire zone");

    await editor.setSelection([0], "replace");
    on(3);
    expect(menu()).toContain(">Link to Sol&#x27;s fallen empire zone</button>");
    on(5);
    expect(menu()).toContain(">Unlink from Sol&#x27;s fallen empire zone</button>");
    on(0);
    expect(menu()).not.toContain("Sol&#x27;s fallen empire zone");

    await editor.setSelection([3], "replace");
    on(5);
    expect(menu()).not.toContain("&#x27;s fallen empire zone");
    await editor.setSelection([0, 3], "replace");
    on(5);
    expect(menu()).not.toContain("&#x27;s fallen empire zone");
  });

  it("offers to link or unlink the one selected system on a ring, and the mod's own rule while the zone takes links", async () => {
    await openLinked(true);
    const editor = useEditorStore.getState();
    onRing(0);
    let html = menu();
    expect(html).not.toContain("to this zone");
    expect(html).toContain(">Use nearest systems instead</button>");

    await editor.setSelection([3], "replace");
    onRing(0);
    expect(menu()).toContain(">Link Sirius to this zone</button>");
    await editor.setSelection([5], "replace");
    onRing(0);
    expect(menu()).toContain(">Unlink Deneb from this zone</button>");
    await editor.setSelection([0], "replace");
    onRing(0);
    expect(menu()).not.toContain("this zone</button>");

    await openLinked(false);
    await useEditorStore.getState().setSelection([3], "replace");
    onRing(0);
    html = menu();
    expect(html).toContain(">Link Sirius to this zone</button>");
    expect(html).not.toContain("Use nearest systems instead");
  });
});

describe("the marauder clan items", () => {
  /** The fixture galaxy as a plain scenario, with the given systems in the given clan roles. */
  async function openWithClans(roles: Record<number, MarauderRole>): Promise<void> {
    vi.mocked(ipc.openSave).mockResolvedValue({
      ...SCENARIO_RESULT,
      painted: false,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        systems: SCENARIO_RESULT.galaxy.systems.map((s) =>
          s.id in roles
            ? {
                ...s,
                initializer: `marauder_${clanOf(roles[s.id])}_${"home" in roles[s.id] ? 1 : 2}`,
                marauder: roles[s.id],
              }
            : s,
        ),
      },
    });
    await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  }

  const item = (html: string, label: string) =>
    html.match(new RegExp(`<button[^>]*>${label}</button>`))![0];

  it("offers the next free clan on empty space of any scenario, until all three are placed", async () => {
    await openWithClans({ 0: { home: 1 } });
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    expect(item(menu(), "Add marauder clan here")).not.toContain("disabled=");

    await openWithClans({ 0: { home: 1 }, 1: { home: 2 }, 2: { home: 3 } });
    chrome.openContextMenu({ target: { kind: "space", x: 0, y: 200 }, x: 0, y: 0 });
    const full = item(menu(), "Add marauder clan here");
    expect(full).toContain("disabled=");
    expect(full).toContain('title="All three clans are placed"');
  });

  /** The clan item: its label, the hint under it, and whether it is disabled. */
  const clanItem = (html: string) => {
    const m = html.match(
      /<button([^>]*)>((?:Add|Make these) marauder clan[^<]*)<span class="muted">([^<]*)<\/span><\/button>/,
    )!;
    return { label: m[2], hint: m[3], disabled: m[1].includes("disabled="), title: m[1] };
  };

  it("asks for three selected systems before it makes a clan, and says how many more under the label", async () => {
    await openWithClans({});
    const chrome = useMapChromeStore.getState();
    const editor = useEditorStore.getState();
    const on = (id: number) =>
      chrome.openContextMenu({ target: { kind: "system", id }, x: 0, y: 0 });

    on(1);
    expect(clanItem(menu())).toMatchObject({
      label: "Add marauder clan",
      hint: "Select two more systems to make a clan",
      disabled: true,
    });
    expect(clanItem(menu()).title).toContain('title="Select two more systems to make a clan"');
    await editor.setSelection([1], "replace");
    on(1);
    expect(clanItem(menu()).hint).toBe("Select two more systems to make a clan");
    await editor.setSelection([1, 2], "replace");
    on(1);
    expect(clanItem(menu())).toMatchObject({ hint: "Select one more system", disabled: true });
    await editor.setSelection([1, 2, 3, 4], "replace");
    on(1);
    expect(clanItem(menu())).toMatchObject({
      hint: "Select exactly three systems",
      disabled: true,
    });
  });

  it("offers no clan item on a system outside a selection", async () => {
    await openWithClans({});
    await useEditorStore.getState().setSelection([1, 2], "replace");
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 3 }, x: 0, y: 0 });
    expect(menu()).not.toContain("marauder clan");
  });

  it("makes the one of three selected systems linked to both others the home, whichever is right-clicked", async () => {
    await openWithClans({ 0: { home: 1 } });
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    for (const id of [0, 1, 2]) {
      useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id }, x: 0, y: 0 });
      const html = menu();
      expect(clanItem(html)).toMatchObject({
        label: "Make these marauder clan 2",
        hint: "Replaces the three initializers, star class included",
        disabled: false,
      });
      expect(clanItem(html).title).toContain(
        'title="Replaces the three initializers, star class included"',
      );
      expect(html).not.toContain("Add marauder clan");
    }
  });

  it("refuses three selected systems none of which is linked to the other two, and says why", async () => {
    await openWithClans({});
    await useEditorStore.getState().setSelection([0, 2, 3], "replace");
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 2 }, x: 0, y: 0 });
    expect(clanItem(menu())).toMatchObject({
      label: "Make these marauder clan 1",
      hint: "The home needs a hyperlane to both outposts",
      disabled: true,
    });
  });

  it("refuses three selected systems once all three clans are placed, and says so", async () => {
    await openWithClans({ 3: { home: 1 }, 4: { home: 2 }, 5: { home: 3 } });
    await useEditorStore.getState().setSelection([0, 1, 2], "replace");
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 1 }, x: 0, y: 0 });
    expect(clanItem(menu())).toMatchObject({
      label: "Add marauder clan",
      hint: "All three clans are placed",
      disabled: true,
    });
  });

  it("offers to remove the clan on a home and on a raid base, saying what that does, and no clan-making item", async () => {
    await openWithClans({ 0: { home: 1 }, 2: { base: 1 } });
    const remove =
      '<button type="button" role="menuitem" class="hinted" title="The three systems become random. Undo puts back what they were">Remove marauder clan 1<span class="muted">The three systems become random. Undo puts back what they were</span></button>';
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    let html = menu();
    expect(html).toContain(remove);
    expect(html).not.toContain("marauder clan here");
    expect(html).not.toContain("Add marauder clan");
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 2 }, x: 0, y: 0 });
    html = menu();
    expect(html).toContain(remove);
    expect(html).not.toContain("Add marauder clan");
  });
});
