import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../test/drawn"));

import * as dialog from "@tauri-apps/plugin-dialog";
import * as ipc from "../../api/ipc";
import { bindStores } from "../../store/bindStores";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import {
  OPEN_RESULT,
  SCENARIO_RESULT,
  countryNode,
  detailOf,
  editResult,
  name,
  node,
  planetSummary,
  systemDetails,
} from "../../store/fixture";
import type { MarauderRole } from "../../generated/MarauderRole";
import { newFeZone } from "../../lib/feZone";
import { clanOf } from "../../lib/marauder";
import { useEditorStore } from "../../store/editorStore";
import { useGameDataStore } from "../../store/gameDataStore";
import type { PickSummary } from "../../generated/PickSummary";
import type { SpecialLayout } from "../../generated/SpecialLayout";
import { armSession, resetStores } from "../../store/storeFixture";
import { openWith } from "../../test/session";
import { useSceneStore } from "../../store/sceneStore";
import { useDetailsStore } from "../../store/detailsStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useLayoutStore } from "../../store/layoutStore";
import { buttons, escaped, menuItem } from "../../test/elements";
import { drawnBy, drawnButton, lastDrawn } from "../../test/drawn";
import { orbitClasses, orbitSystem, planetPage, saveBody } from "../../test/builders";
import { ContextMenu } from "./ContextMenu";
import { MapTooltip } from "./MapTooltip";
import { BeltMenu } from "./contextMenu/BeltMenu";
import { BodyMenu } from "./contextMenu/BodyMenu";
import { SceneSpaceMenu } from "./contextMenu/SceneSpaceMenu";
import { MenuItem } from "./contextMenu/MenuItem";
import type { BodyClassPick } from "../../generated/BodyClassPick";
import { useGeneratorStore } from "../../store/generatorStore";
import type { PlanetMoveTargets } from "../../generated/PlanetMoveTargets";
import { usePlanetMoveStore } from "../../store/planetMoveStore";
import type { ContextTarget } from "../../store/mapChromeStore";
import { PickCardBody } from "./contextMenu/PickCard";
import { SpecialRows } from "./contextMenu/SpecialItems";

bindStores();

const menu = () => renderToStaticMarkup(<ContextMenu />);

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
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
    await openWith(SCENARIO_RESULT);
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
    await openWith(SCENARIO_RESULT, {
      galaxy: { systems: [empty] },
    });
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
    await openWith(SCENARIO_RESULT, {
      painted: true,
      galaxy: {
        systems: [sol, ...SCENARIO_RESULT.galaxy.systems.slice(1)],
      },
    });
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
    await openWith(SCENARIO_RESULT, {
      painted: true,
      galaxy: { systems },
    });
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
    await openWith(SCENARIO_RESULT, {
      painted: false,
      galaxy: {
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

describe("the add system item", () => {
  const space = (x: number, y: number) =>
    useMapChromeStore.getState().openContextMenu({ target: { kind: "space", x, y }, x: 0, y: 0 });

  beforeEach(() => {
    useGameDataStore.setState({ status: "ready" });
  });

  it("offers a rolled system on a clear spot of a save, and nothing linked", () => {
    space(-50, -20);
    const html = menu();
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(1);
    expect(html).toContain('Add system here<span class="context-submenu-caret"');
    expect(html).not.toContain("linked to");
    expect(html).not.toContain("disabled=");
  });

  it("stays on a refused spot, disabled, with the reason under it", () => {
    space(3, 0);
    const html = menu();
    expect(html.match(/aria-haspopup="menu"[^>]*disabled=""/g)).toHaveLength(1);
    expect(html.match(/Too close to [^<]+: 3 away, the game needs 10<\/span>/g)).toHaveLength(1);
  });

  it("is not offered on a scenario", async () => {
    await openWith(SCENARIO_RESULT);
    space(-50, -20);
    expect(menu()).not.toContain("Add system here");
  });

  it("put Delete system on an added system's menu and on no other save system's", () => {
    const sol = useGalaxyStore.getState().systems.get(0)!;
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    expect(menu()).not.toContain("Delete system");

    useGalaxyStore.getState().applyDelta({ systems: [{ ...sol, added: true }] });
    expect(menu()).toContain(">Delete system</button>");
  });
});

describe("the Special menu and the cards", () => {
  const summary = (extra: Partial<PickSummary> = {}): PickSummary => ({
    star_classes: [{ key: "sc_m", name: "Class M Star" }],
    star_description: null,
    planets: { min: 2, max: 5 },
    max_moons: 0,
    moons: "never",
    belts: { min: 0, max: 0 },
    belt_kinds: [],
    asteroids: { min: 0, max: 0 },
    named_bodies: [],
    notable_classes: [],
    modifiers: [],
    rings: "never",
    dlc: null,
    max_instances: null,
    in_galaxy: null,
    ...extra,
  });
  const layout = (key: string, label: string, extra: Partial<SpecialLayout> = {}) => ({
    layout: { key, label, unique: false, capped: false, in_galaxy: 0, dlc: null, ...extra },
    summary: summary(extra.capped ? { max_instances: 1 } : {}),
  });

  it("groups unique systems before the other special systems, each by label, and marks each row", () => {
    const html = renderToStaticMarkup(
      <SpecialRows
        x={0}
        y={0}
        picks={[
          layout("wooden", "Arboreal World", { dlc: { name: "Cosmic Storms", met: false } }),
          layout("zevox", "Zevox", { unique: true, capped: true, in_galaxy: 1 }),
          layout("kira", "Kira", { unique: true, capped: true }),
          layout("trappist", "Trappist", { capped: true }),
          layout("metal", "Metal Planet", { dlc: { name: "Cosmic Storms", met: true } }),
        ]}
      />,
    );
    const order = [
      ...html.matchAll(/>(Unique systems|Other special systems)<|<span>([^<]+)<\/span>/g),
    ].map((m) => m[1] ?? m[2]);
    expect(order).toEqual([
      "Unique systems",
      "Kira",
      "Zevox",
      "Other special systems",
      "Arboreal World",
      "Metal Planet",
      "Trappist",
    ]);
    expect(html.match(/aria-label="Already in this galaxy"/g)).toHaveLength(1);
    expect(html.match(/class="pick-dlc"/g)).toHaveLength(1);
    expect(html).toContain("Needs Cosmic Storms, which this save doesn&#x27;t have");
    expect(html).not.toContain("disabled");
  });

  it("says what a pick can produce and leaves out what it has nothing for", () => {
    const html = renderToStaticMarkup(<PickCardBody title="Random" summary={summary()} />);
    expect(html).toContain("Class M Star");
    expect(html).toContain("2–5");
    expect(html).not.toContain("Belts");
    expect(html).not.toContain("Unique");
  });

  it("says a unique layout is already in the galaxy, in the warning colour", () => {
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Wenkwort"
        summary={summary({
          max_instances: 1,
          in_galaxy: 1,
          belts: { min: 1, max: 1 },
          belt_kinds: [{ key: "rocky_asteroid_belt", name: "Rocky Asteroid Belt", every: true }],
          modifiers: [{ key: "pm_wenkwort_gardens", name: "Wenkwort Gardens", every: true }],
        })}
      />,
    );
    expect(html).toContain("1 (Rocky Asteroid Belt)");
    expect(html).toContain("Wenkwort Gardens");
    expect(html).toContain(
      '<div class="pick-card-note warn">One per galaxy. Already in this galaxy (1). You can still place it.</div>',
    );
  });

  it("says a unique layout is not here yet, and when the save lacks its DLC", () => {
    const html = renderToStaticMarkup(
      <PickCardBody
        title="Arboreal World"
        summary={summary({
          max_instances: 1,
          in_galaxy: 0,
          dlc: { name: "Cosmic Storms", met: false },
        })}
      />,
    );
    expect(html).toContain(
      '<div class="pick-card-note">One per galaxy. Not in this galaxy yet.</div>',
    );
    expect(html).toContain(
      "This save doesn&#x27;t have Cosmic Storms, so its events won&#x27;t run.",
    );
  });
});

describe("the system view's menus", () => {
  it("opens a save's or a scenario's system from its menu, inspects a body from its own, and leaves from either", async () => {
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    expect(menu()).toContain(">Open system view</button>");

    useSceneStore.getState().enterSystem(0);
    const earth = planetSummary({ id: 12, name: name("Earth"), name_key: "Earth" });
    useDetailsStore.setState({
      details: new Map([[0, systemDetails({ id: 0, planets: [earth] })]]),
    });
    const body = { kind: "body", system: 0, id: 12 } as const;
    chrome.openContextMenu({ target: body, x: 0, y: 0 });
    let html = menu();
    expect(html).toContain('<div class="context-menu-header">Earth</div>');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Inspect<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete planet<\/button>/);
    expect(html).toContain('class="context-menu-separated">Back to galaxy</button>');

    useLayoutStore.setState({ tab: "issues" });
    menuItem(<BodyMenu target={body} frame={{}} />, "Inspect").props.onClick();
    const { stack } = useInspectorStore.getState();
    expect(stack.map((e) => e.ref)).toEqual([stack[0].ref, { kind: "planet", id: 12 }]);
    expect(stack[1].label).toBe("Earth");
    expect(useLayoutStore.getState().tab).toBe("inspector");
    expect(useMapChromeStore.getState().contextMenu).toBeNull();

    const target = { kind: "systemSpace", system: 0, x: 5, y: 5 } as const;
    chrome.openContextMenu({ target, x: 0, y: 0 });
    html = menu();
    expect(html).toContain('<div class="context-menu-header">Sol</div>');
    expect(html).toContain(">Back to galaxy</button>");

    menuItem(<SceneSpaceMenu target={target} frame={{}} />, "Back to galaxy").props.onClick();
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
    expect(useMapChromeStore.getState().contextMenu).toBeNull();

    await openWith(SCENARIO_RESULT);
    chrome.openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    expect(menu()).toContain(">Open system view</button>");
  });

  it("deletes a save body after asking, and offers no deletion on a scenario", async () => {
    useSceneStore.getState().enterSystem(0);
    const moon = planetSummary({ id: 13, name: name("Luna"), name_key: "Luna", moon: true });
    useDetailsStore.setState({
      details: new Map([[0, systemDetails({ id: 0, planets: [moon] })]]),
    });
    const body = { kind: "body", system: 0, id: 13 } as const;
    useMapChromeStore.getState().openContextMenu({ target: body, x: 0, y: 0 });
    expect(menu()).toContain(">Delete moon</button>");

    vi.mocked(ipc.getPlanetPage).mockResolvedValue(planetPage({ id: 13 }));
    vi.mocked(dialog.confirm).mockResolvedValue(true);
    vi.mocked(ipc.applyOp).mockResolvedValue(editResult());
    menuItem(<BodyMenu target={body} frame={{}} />, "Delete moon").props.onClick();
    await vi.waitFor(() =>
      expect(ipc.applyOp).toHaveBeenCalledWith({ type: "DeleteBody", body: 13 }),
    );
    expect(dialog.confirm).toHaveBeenCalledWith(
      "Delete Luna? The moon is removed from the save.",
      expect.objectContaining({ kind: "warning" }),
    );

    await openWith(SCENARIO_RESULT);
    useSceneStore.getState().enterSystem(0);
    useMapChromeStore.getState().openContextMenu({ target: body, x: 0, y: 0 });
    expect(menu()).not.toContain("Delete");
  });
});

describe("a body's lock in the system view", () => {
  const [PLANET, MOON, COMPANION, ITS_PLANET] = [2, 3, 8, 9];
  const target = (id: number) => ({ kind: "body", system: 0, id }) as const;

  function inBinary(): void {
    useSceneStore.getState().enterSystem(0);
    const details = orbitSystem({ id: 0 });
    const planets = [
      ...details.planets,
      saveBody(COMPANION, "pc_g_star", [-240, 0], 240, 20),
      saveBody(ITS_PLANET, "pc_arid", [-224, 0], 16, 10, COMPANION),
    ].map((p) => ({ ...p, name: name(`P${p.id}`), name_key: `P${p.id}` }));
    useDetailsStore.setState({ details: new Map([[0, { ...details, planets }]]) });
    useGameDataStore.setState({ planetClasses: orbitClasses() });
  }

  const menuOn = (id: number) => {
    useMapChromeStore.getState().openContextMenu({ target: target(id), x: 0, y: 0 });
    return buttons(menu());
  };

  it("names what the body orbits: the star at the centre, its planet, or the companion star, and offers no lock on the centre's star", () => {
    inBinary();
    expect(menuOn(PLANET)).toContain("Lock to the star");
    expect(menuOn(MOON)).toContain("Lock to P2");
    expect(menuOn(ITS_PLANET)).toContain("Lock to P8");
    expect(menuOn(1).some((b) => b.startsWith("Lock"))).toBe(false);
  });

  it("locks the body, then unlocks it, as a view setting with no edit", () => {
    inBinary();
    menuItem(<BodyMenu target={target(MOON)} frame={{}} />, "Lock to P2").props.onClick();
    expect(useSceneStore.getState().lockedBodies.has(MOON)).toBe(true);
    expect(menuOn(MOON)).toContain("Unlock");

    menuItem(<BodyMenu target={target(MOON)} frame={{}} />, "Unlock").props.onClick();
    expect(useSceneStore.getState().lockedBodies.has(MOON)).toBe(false);
    expect(ipc.applyOp).not.toHaveBeenCalled();
  });

  it("offers no lock on a scenario", async () => {
    await openWith(SCENARIO_RESULT);
    inBinary();
    expect(menuOn(PLANET).some((b) => b.startsWith("Lock"))).toBe(false);
  });
});

describe("a belt's handle in the system view", () => {
  const target = { kind: "belt", system: 0, index: 0 } as const;

  function inSol(): void {
    useSceneStore.getState().enterSystem(0);
    const belts = [{ kind: "icy_asteroid_belt", inner_radius: 80 }];
    useDetailsStore.setState({ details: new Map([[0, systemDetails({ id: 0, belts })]]) });
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
  }

  it("removes the belt once on a save", async () => {
    inSol();
    const html = menu();
    expect(html).toContain(">Remove belt</button>");
    expect(html.indexOf("Remove belt")).toBeLessThan(html.indexOf("Back to galaxy"));
    menuItem(<BeltMenu target={target} frame={{}} />, "Remove belt").props.onClick();
    await vi.waitFor(() =>
      expect(ipc.applyOp).toHaveBeenCalledWith({ type: "RemoveBelt", system: 0, index: 0 }),
    );
    const removes = vi.mocked(ipc.applyOp).mock.calls.filter(([op]) => op.type === "RemoveBelt");
    expect(removes).toHaveLength(1);
  });

  it("offers no removal on a scenario", async () => {
    await openWith(SCENARIO_RESULT);
    inSol();
    const html = menu();
    expect(html).not.toContain("Remove belt");
    expect(html).toContain(">Back to galaxy</button>");
  });
});

describe("the system view's empty space", () => {
  const target = { kind: "systemSpace", system: 0, x: 90, y: -120 } as const;

  function inSol(): void {
    useSceneStore.getState().enterSystem(0);
    const belts = [{ kind: "icy_asteroid_belt", inner_radius: 80 }];
    useDetailsStore.setState({ details: new Map([[0, systemDetails({ id: 0, belts })]]) });
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
  }

  it("adds a belt of the system's first kind where it was pressed on a save", async () => {
    inSol();
    const html = menu();
    expect(html).toContain(">Add belt here (r 150)</button>");
    expect(html.indexOf("Add belt here")).toBeLessThan(html.indexOf("Back to galaxy"));

    menuItem(
      <SceneSpaceMenu target={target} frame={{}} />,
      "Add belt here (r 150)",
    ).props.onClick();
    await vi.waitFor(() =>
      expect(ipc.applyOp).toHaveBeenCalledWith({
        type: "AddBelt",
        system: 0,
        kind: "icy_asteroid_belt",
        radius: 150,
      }),
    );
  });

  it("offers no belt on a scenario", async () => {
    await openWith(SCENARIO_RESULT);
    inSol();
    const html = menu();
    expect(html).not.toContain("Add belt here");
    expect(html).toContain(">Back to galaxy</button>");
  });
});

describe("adding a planet or moon in the system view", () => {
  const space = { kind: "systemSpace", system: 0, x: 90, y: -120 } as const;
  const body = (id: number) => ({ kind: "body", system: 0, id }) as const;
  const desert: BodyClassPick = { key: "pc_desert", name: "Desert", min_size: 10, max_size: 25 };
  const barren: BodyClassPick = { key: "pc_barren", name: "Barren", min_size: 5, max_size: 5 };

  beforeEach(() => {
    useSceneStore.getState().enterSystem(0);
    const planets = orbitSystem({ id: 0 }).planets.map((p) => ({
      ...p,
      name: name(`P${p.id}`),
      name_key: `P${p.id}`,
    }));
    useDetailsStore.setState({ details: new Map([[0, systemDetails({ id: 0, planets })]]) });
    useGameDataStore.setState({ status: "ready", planetClasses: orbitClasses() });
    useGeneratorStore.setState({ planetClasses: [desert], moonClasses: [barren] });
    vi.mocked(ipc.addBody).mockResolvedValue({
      edit: editResult({ details_stale: [0] }),
      planet: 20,
    });
  });

  const menuOn = (target: ContextTarget) => {
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
    return menu();
  };

  /** The row of the class list named `label` that the last render drew. */
  const row = (label: string) =>
    lastDrawn(
      ({ type, props }) =>
        type === MenuItem &&
        (Array.isArray(props.children) ? props.children : [props.children]).includes(label),
      `row ${label}`,
    ) as { run(): unknown };

  it("offers a planet on a save's empty space, and adds the class picked where it was pressed, selected with its page open once its details land", async () => {
    const html = drawnBy(() => menuOn(space));
    expect(html).toContain('Add planet here<span class="context-submenu-caret"');
    expect(html.indexOf("Add planet here")).toBeLessThan(html.indexOf("Back to galaxy"));
    expect(html).not.toMatch(/aria-haspopup="menu"[^>]*disabled=""/);

    await row("Desert").run();
    expect(ipc.addBody).toHaveBeenCalledWith(
      0,
      null,
      "pc_desert",
      null,
      150,
      307,
      expect.any(Number),
    );
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "planet", id: 20 });

    const read = useDetailsStore.getState().details.get(0)!;
    const added = planetSummary({ id: 20, class: "pc_desert", name: name("P20"), name_key: "P20" });
    useDetailsStore.setState({
      details: new Map([[0, { ...read, planets: [...read.planets, added] }]]),
    });
    expect(useSceneStore.getState().bodySelection).toEqual({ system: 0, ids: [20] });
  });

  it("rolls a random planet, of no class asked for", async () => {
    drawnBy(() => menuOn(space));
    await row("Random").run();
    expect(ipc.addBody).toHaveBeenCalledWith(0, null, null, null, 150, 307, expect.any(Number));
  });

  it("stays without game data, disabled, with the reason under it", () => {
    useGameDataStore.setState({ status: "idle" });
    const html = menuOn(space);
    expect(html).toMatch(/aria-haspopup="menu"[^>]*disabled=""/);
    expect(html).toContain("Load game data to add a planet or moon.");
  });

  it("offers a moon of a planet on the next moon ring, and none of a moon, the star or an asteroid", async () => {
    const html = drawnBy(() => menuOn(body(2)));
    expect(html).toContain('Add moon<span class="context-submenu-caret"');
    await row("Barren").run();
    expect(ipc.addBody).toHaveBeenCalledWith(0, 2, "pc_barren", null, 25, 0, expect.any(Number));

    for (const id of [1, 3, 6]) expect(menuOn(body(id))).not.toContain("Add moon");
  });

  it("is not offered on a scenario or a save that cannot take it", async () => {
    useFileSessionStore.setState({
      capabilities: { ...useFileSessionStore.getState().capabilities!, added_systems: false },
    });
    expect(menuOn(space)).not.toContain("Add planet here");
    expect(menuOn(body(2))).not.toContain("Add moon");

    await openWith(SCENARIO_RESULT);
    useSceneStore.getState().enterSystem(0);
    expect(menuOn(space)).not.toContain("Add planet here");
    expect(menuOn(body(2))).not.toContain("Add moon");
  });
});

describe("moving planets", () => {
  const [SOL, CENTAURI, BARNARD] = [0, 1, 2];
  const [EARTH, MARS] = [12, 13];
  const HISSMAN = 7;
  const colony = { planet: MARS, kind: "colony", owner: 0, new_owner: HISSMAN } as const;
  const station = { planet: EARTH, kind: "station", owner: 0, new_owner: HISSMAN } as const;
  const moves = () => usePlanetMoveStore.getState();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const targets = (planets: number[], over: Partial<PlanetMoveTargets> = {}) => ({
    planets,
    refused: [],
    systems: [
      { system: CENTAURI, warnings: [] },
      { system: BARNARD, warnings: [colony, station] },
    ],
    ...over,
  });

  beforeEach(() => {
    useSceneStore.getState().enterSystem(SOL);
    const planets = [
      planetSummary({ id: EARTH, name: name("Earth"), name_key: "Earth" }),
      planetSummary({ id: MARS, name: name("Mars"), name_key: "Mars" }),
    ];
    useDetailsStore.setState({ details: new Map([[SOL, systemDetails({ id: SOL, planets })]]) });
    const hissman = { key: "Hissman Consciousness", literal: true, variables: [] };
    useGalaxyStore.setState({
      countries: new Map([
        [HISSMAN, countryNode({ id: HISSMAN, name: hissman, name_key: hissman.key })],
      ]),
    });
    vi.mocked(ipc.planetMoveTargets).mockImplementation(async (ids) => targets(ids));
  });

  async function selectBoth(): Promise<void> {
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    await settle();
  }

  const openOn = (target: ContextTarget) =>
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });

  it("cuts the selection from a body's menu, and says why it cannot", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    const body = { kind: "body", system: SOL, id: EARTH } as const;
    openOn(body);
    expect(menu()).toMatch(/<button[^>]*disabled=""[^>]*>Cut 2 planets<\/button>/);

    await settle();
    expect(menu()).toContain('role="menuitem">Cut 2 planets</button>');
    menuItem(<BodyMenu target={body} frame={{}} />, "Cut 2 planets").props.onClick();
    expect(moves().cut).toMatchObject({ planets: [EARTH, MARS], from: SOL });

    const reason = "Earth has an arc furnace: planets with a megastructure can't move";
    vi.mocked(ipc.planetMoveTargets).mockResolvedValue(
      targets([EARTH, MARS], { refused: [{ planet: EARTH, reason }], systems: [] }),
    );
    useSceneStore.getState().toggleBody(SOL, MARS);
    useSceneStore.getState().toggleBody(SOL, MARS);
    await settle();
    openOn(body);
    expect(menu()).toContain(`disabled="" title="${escaped(reason)}">Cut 2 planets</button>`);
  });

  it("puts Paste first on a system's menu, with the first warning under it and all of them on hover", async () => {
    await selectBoth();
    moves().cutSelection();
    useSceneStore.getState().exitScene();

    openOn({ kind: "system", id: CENTAURI });
    let html = menu();
    expect(buttons(html)[0]).toBe("Paste 2 planets here");
    expect(html).not.toContain("⚠");

    openOn({ kind: "system", id: BARNARD });
    html = menu();
    expect(buttons(html)[0]).toBe(
      "Paste 2 planets here ⚠ Mars will change ownership to Hissman Consciousness about a month after you load (and 1 more)",
    );
    expect(html).toContain(
      'title="Mars will change ownership to Hissman Consciousness about a month after you load\n' +
        'Earth&#x27;s station will change ownership to Hissman Consciousness"',
    );
    expect(html).toContain('<span class="warn">⚠ ');

    drawnBy(menu);
    drawnButton("Paste 2 planets here").onClick();
    await vi.waitFor(() =>
      expect(ipc.planetMoveOp).toHaveBeenCalledWith([EARTH, MARS], BARNARD, null),
    );
  });

  it("refuses a paste back into the planets' own system without asking the core", async () => {
    await selectBoth();
    moves().cutSelection();
    openOn({ kind: "system", id: SOL });
    expect(menu()).toContain(
      'disabled="" title="These planets are already in Sol">Paste 2 planets here</button>',
    );

    useSceneStore.getState().selectBody(SOL, EARTH);
    await settle();
    moves().cutSelection();
    openOn({ kind: "systemSpace", system: SOL, x: 0, y: 50 });
    expect(menu()).toContain('disabled="" title="Earth is already in Sol">Paste Earth here');
    expect(ipc.planetMoveCheck).not.toHaveBeenCalled();
  });

  it("pastes a lone planet where the system view's space was pressed, and names the orbit", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    await settle();
    moves().cutSelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    const target = { kind: "systemSpace", system: CENTAURI, x: 0, y: 108 } as const;
    const at = { radius: 108, angle: 90 };
    vi.mocked(ipc.planetMoveCheck).mockResolvedValue({ refusal: null, warnings: [] });
    await moves().checkPaste(CENTAURI, at);
    openOn(target);
    const label = "Paste Earth here (orbit 108 · 90°)";
    expect(buttons(menu())[0]).toBe(label);

    drawnBy(menu);
    drawnButton(label).onClick();
    await vi.waitFor(() => expect(ipc.planetMoveOp).toHaveBeenCalledWith([EARTH], CENTAURI, at));
  });

  it("names a lone body in its Cut", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    await settle();
    openOn({ kind: "body", system: SOL, id: EARTH });
    expect(menu()).toContain('role="menuitem">Cut Earth</button>');
  });

  it("hides the map's tooltip while a menu is open", () => {
    const tooltip = () => renderToStaticMarkup(<MapTooltip />);
    useMapChromeStore.getState().showTooltip({ x: 0, y: 0, title: "Sol", lines: [] });
    expect(tooltip()).toContain("Sol");
    openOn({ kind: "system", id: SOL });
    expect(tooltip()).toBe("");
  });

  it("offers no Paste without a cut", () => {
    openOn({ kind: "system", id: CENTAURI });
    expect(menu()).not.toContain("Paste");
    openOn({ kind: "systemSpace", system: SOL, x: 5, y: 5 });
    expect(menu()).not.toContain("Paste");
  });
});
