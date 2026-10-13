import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as dialog from "@tauri-apps/plugin-dialog";
import * as ipc from "../../api/ipc";
import { bindStores } from "../../store/bindStores";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import {
  OPEN_RESULT,
  SCENARIO_RESULT,
  editResult,
  entityNode,
  entityView,
  name,
  planetSummary,
  scalar,
  systemDetails,
} from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { inSystem, openWith } from "../../test/session";
import { useSceneStore } from "../../store/sceneStore";
import { useDetailsStore } from "../../store/detailsStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useLayoutStore } from "../../store/layoutStore";
import { buttons, menuItem } from "../../test/elements";
import { drawnBy, lastDrawn } from "../../test/drawn";
import {
  megastructureSummary,
  megastructureTypeView,
  namedPlanets,
  orbitClasses,
  orbitSystem,
  planetPage,
  saveBody,
  solWithBelt,
} from "../../test/builders";
import { ContextMenu } from "./ContextMenu";
import { BeltMenu } from "./contextMenu/BeltMenu";
import { BodyMenu } from "./contextMenu/BodyMenu";
import { BodyRowMenu } from "./contextMenu/BodyRowMenu";
import { MegastructureMenu } from "./contextMenu/MegastructureMenu";
import { SceneSpaceMenu } from "./contextMenu/SceneSpaceMenu";
import { MenuItem } from "./contextMenu/MenuItem";
import type { BodyClassPick } from "../../generated/BodyClassPick";
import { useGeneratorStore } from "../../store/generatorStore";
import { usePlanetMoveStore } from "../../store/planetMoveStore";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import {
  ADD_MEGASTRUCTURE_HERE_LABEL,
  ADD_MEGASTRUCTURE_LABEL,
  MEGASTRUCTURES_NEED_GAME_DATA,
} from "../../lib/megastructureCopy";
import { placementAt } from "../../lib/planetMove";
import type { ContextTarget } from "../../store/mapChromeStore";
import { until } from "../../test/wait";
import { flush } from "../../test/flush";

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

  it("deletes a save body after asking", async () => {
    const moon = planetSummary({ id: 13, name: name("Luna"), name_key: "Luna", moon: true });
    inSystem(systemDetails({ id: 0, planets: [moon] }));
    const body = { kind: "body", system: 0, id: 13 } as const;
    useMapChromeStore.getState().openContextMenu({ target: body, x: 0, y: 0 });
    expect(menu()).toContain(">Delete moon</button>");

    vi.mocked(ipc.getPlanetPage).mockResolvedValue(planetPage({ id: 13 }));
    vi.mocked(dialog.confirm).mockResolvedValue(true);
    vi.mocked(ipc.applyOp).mockResolvedValue(editResult());
    menuItem(<BodyMenu target={body} frame={{}} />, "Delete moon").props.onClick();
    await until(() => expect(ipc.applyOp).toHaveBeenCalledWith({ type: "DeleteBody", body: 13 }));
    expect(dialog.confirm).toHaveBeenCalledWith(
      "Delete Luna? The moon is removed from the save.",
      expect.objectContaining({ kind: "warning" }),
    );
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
});

describe("a belt's handle in the system view", () => {
  const target = { kind: "belt", system: 0, index: 0 } as const;

  it("removes the belt once on a save", async () => {
    inSol(target);
    const html = menu();
    expect(html).toContain(">Remove belt</button>");
    expect(html.indexOf("Remove belt")).toBeLessThan(html.indexOf("Back to galaxy"));
    menuItem(<BeltMenu target={target} frame={{}} />, "Remove belt").props.onClick();
    await until(() =>
      expect(ipc.applyOp).toHaveBeenCalledWith({ type: "RemoveBelt", system: 0, index: 0 }),
    );
    const removes = vi.mocked(ipc.applyOp).mock.calls.filter(([op]) => op.type === "RemoveBelt");
    expect(removes).toHaveLength(1);
  });
});

describe("a megastructure in the system view", () => {
  const target = { kind: "megastructure", system: 0, id: 6 } as const;

  function atTheNexus(): void {
    const nexus = megastructureSummary({ id: 6, kind: "think_tank_3" });
    inSystem(systemDetails({ id: 0, megastructures: [nexus] }));
    useGameDataStore.setState({ names: new Map([["think_tank_3", "Science Nexus"]]) });
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
  }

  it("inspects it, and deletes it after asking", async () => {
    atTheNexus();
    const html = menu();
    expect(html).toContain('<div class="context-menu-header">Science Nexus</div>');
    expect(html.indexOf("Inspect")).toBeLessThan(html.indexOf("Delete megastructure"));
    expect(html.indexOf("Delete megastructure")).toBeLessThan(html.indexOf("Back to galaxy"));
    expect(ipc.checkOp).toHaveBeenCalledWith({ type: "DeleteMegastructure", megastructure: 6 });

    menuItem(<MegastructureMenu target={target} frame={{}} />, "Inspect").props.onClick();
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1]).toEqual({
      ref: { kind: "megastructure", id: 6 },
      label: "Science Nexus",
    });

    vi.mocked(ipc.getEntity).mockResolvedValue(
      entityView("megastructure", { nodes: [entityNode("type", scalar("think_tank_3"))] }),
    );
    vi.mocked(dialog.confirm).mockResolvedValue(true);
    vi.mocked(ipc.deleteMegastructure).mockResolvedValue(editResult());
    await flush();
    menuItem(
      <MegastructureMenu target={target} frame={{}} />,
      "Delete megastructure",
    ).props.onClick();
    await until(() => expect(ipc.deleteMegastructure).toHaveBeenCalledWith(6));
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/^Delete Science Nexus in Sol\? It is removed from the save\./),
      expect.objectContaining({ kind: "warning" }),
    );
    expect(useInspectorStore.getState().stack.map((e) => e.ref.kind)).not.toContain(
      "megastructure",
    );
  });

  it("greys Delete out with the core's reason", async () => {
    const refusal = "megastructure 6 cannot be deleted: its bypass is a lgate";
    vi.mocked(ipc.checkOp).mockResolvedValue(refusal);
    atTheNexus();
    menu();
    await flush();
    const html = menu();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete megastructure<span/);
    expect(html).toContain(`<span class="muted">${refusal}</span>`);
  });

  it("offers to snap a floating megastructure standing away from its planet back to it", async () => {
    const [planet] = namedPlanets([saveBody(5, "pc_arid", [100, 0], 100, 12)]);
    const away = megastructureSummary({ id: 6, kind: "think_tank_3", planet: 5, at: [-40, 30] });
    inSystem(systemDetails({ id: 0, planets: [planet], megastructures: [away] }));
    useGameDataStore.setState({
      names: new Map([["think_tank_3", "Science Nexus"]]),
      megastructureTypes: new Map([["think_tank_3", megastructureTypeView("think_tank_3")]]),
    });
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
    const item = menuItem(<MegastructureMenu target={target} frame={{}} />, "Snap to P5");
    vi.mocked(ipc.applyOp).mockResolvedValue(editResult());
    item.props.onClick();
    await until(() =>
      expect(ipc.applyOp).toHaveBeenCalledWith({
        type: "MoveMegastructure",
        megastructure: 6,
        at: { place: "body", body: 5 },
      }),
    );
  });

  it("offers no snap to a megastructure at its planet's point", () => {
    atTheNexus();
    expect(menu()).not.toContain("Snap to");
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
    await until(() =>
      expect(ipc.applyOp).toHaveBeenCalledWith({
        type: "AddBelt",
        system: 0,
        kind: "icy_asteroid_belt",
        radius: 150,
      }),
    );
  });

  it("pastes a copied group where it was pressed", async () => {
    const copies = [{ class: "pc_arid" }, { class: "pc_desert" }] as never[];
    const planets = [
      { name: "Earth", moon: false },
      { name: "Mars", moon: false },
    ];
    vi.mocked(ipc.pasteBodiesOp).mockResolvedValue({ type: "Batch", description: "x", ops: [] });
    vi.mocked(ipc.applyOp).mockResolvedValue(editResult());
    usePlanetMoveStore.setState({ copy: { copies, planets, from: 0 } });
    inSol(target);
    menuItem(<SceneSpaceMenu target={target} frame={{}} />, "Paste 2 planets here").props.onClick();
    await until(() =>
      expect(ipc.pasteBodiesOp).toHaveBeenCalledWith(0, copies, placementAt(target.x, target.y)),
    );
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
      planets: [20],
      megastructures: [],
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

  it("is not offered on a save that cannot take it", () => {
    useFileSessionStore.setState({
      capabilities: { ...useFileSessionStore.getState().capabilities!, add_bodies: false },
    });
    expect(menuOn(space)).not.toContain("Add planet here");
    expect(menuOn(body(2))).not.toContain("Add moon");
  });
});

describe("adding a megastructure in the system view", () => {
  const space = { kind: "systemSpace", system: 0, x: 90, y: -120 } as const;
  const body = (id: number) => ({ kind: "body", system: 0, id }) as const;
  const prompt = () => useMegastructureAddStore.getState().prompt;

  beforeEach(() => {
    inSystem(systemDetails({ id: 0, planets: namedPlanets(orbitSystem({ id: 0 }).planets) }));
    useGameDataStore.setState({ status: "ready", planetClasses: orbitClasses() });
  });

  const menuOn = (target: ContextTarget) => {
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
    return menu();
  };

  it("opens the dialog where empty space was pressed, and on a planet or the star", () => {
    expect(buttons(menuOn(space))).toContain(ADD_MEGASTRUCTURE_HERE_LABEL);
    menuItem(
      <SceneSpaceMenu target={space} frame={{}} />,
      ADD_MEGASTRUCTURE_HERE_LABEL,
    ).props.onClick();
    expect(prompt()).toEqual({ system: 0, spot: { kind: "space", x: 90, y: -120 } });

    expect(buttons(menuOn(body(2)))).toContain(ADD_MEGASTRUCTURE_LABEL);
    menuItem(<BodyMenu target={body(2)} frame={{}} />, ADD_MEGASTRUCTURE_LABEL).props.onClick();
    expect(prompt()).toEqual({
      system: 0,
      spot: { kind: "body", body: 2, star: false, class: "pc_continental" },
    });

    menuItem(<BodyMenu target={body(1)} frame={{}} />, ADD_MEGASTRUCTURE_LABEL).props.onClick();
    expect(prompt()).toEqual({
      system: 0,
      spot: { kind: "body", body: 1, star: true, class: "pc_g_star" },
    });
  });

  it("opens on a body that has one, where the dialog greys out the rows, and stays disabled without game data", () => {
    const read = useDetailsStore.getState().details.get(0)!;
    const ring = megastructureSummary({ kind: "orbital_ring_ruined", planet: 2 });
    useDetailsStore.setState({
      details: new Map([[0, { ...read, megastructures: [ring] }]]),
    });
    let html = menuOn(body(2));
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Add megastructure…/);

    useGameDataStore.setState({ status: "idle" });
    html = menuOn(space);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add megastructure here…/);
    expect(html).toContain(MEGASTRUCTURES_NEED_GAME_DATA);
  });
});

describe("a body row's menu", () => {
  const row = (id: number) => ({ kind: "bodyRow", system: 0, id }) as const;

  /** Sol's star, Earth and its moon Luna, as Sol's details list them. */
  function landSol(): void {
    const planets = [
      planetSummary({ id: 10, name: name("Sol"), name_key: "Sol", class: "pc_g_star" }),
      planetSummary({ id: 12, name: name("Earth"), name_key: "Earth" }),
      planetSummary({ id: 13, name: name("Luna"), name_key: "Luna", moon: true, parent: 12 }),
    ];
    useDetailsStore.setState({ details: new Map([[0, systemDetails({ id: 0, planets })]]) });
  }

  function openRow(id: number): string {
    useMapChromeStore.getState().openContextMenu({ target: row(id), x: 0, y: 0 });
    return menu();
  }

  it("goes to a planet, a moon or a star, as the row lists it", () => {
    landSol();
    expect(openRow(12)).toContain('<div class="context-menu-header">Earth</div>');
    expect(buttons(openRow(12))).toEqual(["Go to planet"]);
    expect(buttons(openRow(13))).toEqual(["Go to moon"]);
    expect(buttons(openRow(10))).toEqual(["Go to star"]);
  });

  it("opens the system view on the body from the galaxy, and in the system shown only selects it", () => {
    landSol();
    menuItem(<BodyRowMenu target={row(12)} frame={{}} />, "Go to planet").props.onClick();
    const entered = useSceneStore.getState();
    expect(entered.scene).toEqual({ kind: "system", id: 0 });
    expect(entered.bodySelection).toEqual({ system: 0, ids: [12] });
    expect(entered.bodyFocus?.id).toBe(12);
    expect(useMapChromeStore.getState().contextMenu).toBeNull();

    menuItem(<BodyRowMenu target={row(13)} frame={{}} />, "Go to moon").props.onClick();
    const scene = useSceneStore.getState();
    expect(scene.visit).toBe(entered.visit);
    expect(scene.bodySelection).toEqual({ system: 0, ids: [13] });
    expect(scene.bodyFocus?.id).toBe(13);
  });
});

describe("a scenario's system view menus", () => {
  const body = (id: number) => ({ kind: "body", system: 0, id }) as const;
  const space = { kind: "systemSpace", system: 0, x: 90, y: -120 } as const;

  function inOrbitSystem(): void {
    const details = orbitSystem({ id: 0 });
    inSystem({ ...details, planets: namedPlanets(details.planets) });
    useGameDataStore.setState({ status: "ready", planetClasses: orbitClasses() });
    useGeneratorStore.setState({
      planetClasses: [{ key: "pc_desert", name: "Desert", min_size: 10, max_size: 25 }],
      moonClasses: [{ key: "pc_barren", name: "Barren", min_size: 5, max_size: 5 }],
    });
  }

  const cases: {
    name: string;
    setup: () => void;
    /** What a save's menu on each target offers. */
    offers: [ContextTarget, string][];
    /** The name in the menu's header, which a scenario's menu keeps. */
    header?: string;
  }[] = [
    {
      name: "body deletion",
      setup: () =>
        inSystem(
          systemDetails({
            id: 0,
            planets: [planetSummary({ id: 13, name: name("Luna"), name_key: "Luna", moon: true })],
          }),
        ),
      offers: [[body(13), "Delete moon"]],
    },
    { name: "body lock", setup: inOrbitSystem, offers: [[body(2), "Lock to"]] },
    {
      name: "belt removal",
      setup: () => inSystem(solWithBelt()),
      offers: [[{ kind: "belt", system: 0, index: 0 }, "Remove belt"]],
    },
    {
      name: "belt in empty space",
      setup: () => inSystem(solWithBelt()),
      offers: [[space, "Add belt here"]],
    },
    {
      name: "megastructure page and deletion",
      setup: () => {
        inSystem(
          systemDetails({
            id: 0,
            megastructures: [megastructureSummary({ id: 6, kind: "think_tank_3" })],
          }),
        );
        useGameDataStore.setState({ names: new Map([["think_tank_3", "Science Nexus"]]) });
      },
      header: "Science Nexus",
      offers: [
        [{ kind: "megastructure", system: 0, id: 6 }, "Inspect"],
        [{ kind: "megastructure", system: 0, id: 6 }, "Delete megastructure"],
      ],
    },
    {
      name: "planet and moon",
      setup: inOrbitSystem,
      offers: [
        [space, "Add planet here"],
        [body(2), "Add moon"],
      ],
    },
    {
      name: "megastructure add",
      setup: inOrbitSystem,
      offers: [
        [space, "Add megastructure"],
        [body(2), "Add megastructure"],
      ],
    },
  ];

  const menuOn = (target: ContextTarget) => {
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });
    return menu();
  };

  it.each(cases)(
    "offers no $name, which a save's menu offers",
    async ({ setup, offers, header }) => {
      setup();
      for (const [target, text] of offers) expect(menuOn(target)).toContain(text);

      await openWith(SCENARIO_RESULT);
      setup();
      for (const [target, text] of offers) {
        const html = menuOn(target);
        expect(html).not.toContain(text);
        expect(html).toContain(">Back to galaxy</button>");
        if (header !== undefined) {
          expect(html).toContain(`<div class="context-menu-header">${header}</div>`);
        }
      }
    },
  );
});
