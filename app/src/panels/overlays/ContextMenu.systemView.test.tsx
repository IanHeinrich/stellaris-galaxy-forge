import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
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
  editResult,
  name,
  planetSummary,
  systemDetails,
} from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { inSystem, openWith } from "../../test/session";
import { useSceneStore } from "../../store/sceneStore";
import { useDetailsStore } from "../../store/detailsStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useLayoutStore } from "../../store/layoutStore";
import { buttons, escaped, menuItem } from "../../test/elements";
import { drawnBy, drawnButton, lastDrawn } from "../../test/drawn";
import {
  namedPlanets,
  orbitClasses,
  orbitSystem,
  planetPage,
  saveBody,
  solWithBelt,
} from "../../test/builders";
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

bindStores();

const menu = () => renderToStaticMarkup(<ContextMenu />);

/** Sol in the system view with its belt, and the menu opened on `target`. */
function inSol(target: ContextTarget): void {
  inSystem(solWithBelt());
  useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
}

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
});

describe("the system view's menus", () => {
  it("opens a save's or a scenario's system from its menu, inspects a body from its own, and leaves from either", async () => {
    const chrome = useMapChromeStore.getState();
    chrome.openContextMenu({ target: { kind: "system", id: 0 }, x: 0, y: 0 });
    expect(menu()).toContain(">Open system view</button>");

    const earth = planetSummary({ id: 12, name: name("Earth"), name_key: "Earth" });
    inSystem(systemDetails({ id: 0, planets: [earth] }));
    const body = { kind: "body", system: 0, id: 12 } as const;
    chrome.openContextMenu({ target: body, x: 0, y: 0 });
    let html = menu();
    expect(html).toContain('<div class="context-menu-header">Earth</div>');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Inspect<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete planet<\/button>/);
    expect(buttons(html)).toContain("Back to galaxy");

    useLayoutStore.setState({ tab: "issues" });
    menuItem(<BodyMenu target={body} frame={{}} />, "Inspect").props.onClick();
    const { stack } = useInspectorStore.getState();
    expect(stack.map((e) => e.ref)).toEqual([stack[0].ref, { kind: "body", system: 0, id: 12 }]);
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
    const moon = planetSummary({ id: 13, name: name("Luna"), name_key: "Luna", moon: true });
    inSystem(systemDetails({ id: 0, planets: [moon] }));
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
    const details = orbitSystem({ id: 0 });
    const companion = saveBody(COMPANION, "pc_g_star", [-240, 0], 240, 20);
    const planets = namedPlanets([
      ...details.planets,
      companion,
      saveBody(ITS_PLANET, "pc_arid", [-224, 0], 16, 10, companion),
    ]);
    inSystem({ ...details, planets });
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

  it("removes the belt once on a save", async () => {
    inSol(target);
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
    inSol(target);
    const html = menu();
    expect(html).not.toContain("Remove belt");
    expect(html).toContain(">Back to galaxy</button>");
  });
});

describe("the system view's empty space", () => {
  const target = { kind: "systemSpace", system: 0, x: 90, y: -120 } as const;

  it("adds a belt of the system's first kind where it was pressed on a save", async () => {
    inSol(target);
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
    inSol(target);
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
    inSystem(systemDetails({ id: 0, planets: namedPlanets(orbitSystem({ id: 0 }).planets) }));
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
    expect(buttons(html)).toContain("Add planet here ▸");
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
    expect(stack[stack.length - 1].ref).toEqual({ kind: "body", system: 0, id: 20 });

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
    expect(buttons(html)).toContain("Add moon ▸");
    await row("Barren").run();
    expect(ipc.addBody).toHaveBeenCalledWith(0, 2, "pc_barren", null, 25, 0, expect.any(Number));

    for (const id of [1, 3, 6]) expect(menuOn(body(id))).not.toContain("Add moon");
  });

  it("is not offered on a scenario or a save that cannot take it", async () => {
    useFileSessionStore.setState({
      capabilities: { ...useFileSessionStore.getState().capabilities!, add_bodies: false },
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
    const planets = [
      planetSummary({ id: EARTH, name: name("Earth"), name_key: "Earth" }),
      planetSummary({ id: MARS, name: name("Mars"), name_key: "Mars" }),
    ];
    inSystem(systemDetails({ id: SOL, planets }));
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
