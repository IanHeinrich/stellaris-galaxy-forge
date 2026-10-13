import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { bindStores } from "../../store/bindStores";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { OPEN_RESULT, countryNode, name, planetSummary, systemDetails } from "../../store/fixture";
import { armSession, resetStores } from "../../store/storeFixture";
import { inSystem, openWith } from "../../test/session";
import { useSceneStore } from "../../store/sceneStore";
import { buttons, escaped } from "../../test/elements";
import { ContextMenu } from "./ContextMenu";
import { MapTooltip } from "./MapTooltip";
import type { PlanetMoveTargets } from "../../generated/PlanetMoveTargets";
import { usePlanetMoveStore } from "../../store/planetMoveStore";
import type { ContextTarget } from "../../store/mapChromeStore";
import { flush } from "../../test/flush";

bindStores();

const menu = () => renderToStaticMarkup(<ContextMenu />);

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(OPEN_RESULT);
});

describe("the menus of moving planets", () => {
  const [SOL, CENTAURI, BARNARD] = [0, 1, 2];
  const [EARTH, MARS] = [12, 13];
  const HISSMAN = 7;
  const colony = { planet: MARS, kind: "colony", owner: 0, new_owner: HISSMAN } as const;
  const station = { planet: EARTH, kind: "station", owner: 0, new_owner: HISSMAN } as const;
  const moves = () => usePlanetMoveStore.getState();
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
    await flush();
  }

  const openOn = (target: ContextTarget) =>
    useMapChromeStore.getState().openContextMenu({ target, x: 0, y: 0 });

  it("labels Cut on a body's menu, disabled until the core answers, and says why it cannot", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    openOn({ kind: "body", system: SOL, id: EARTH });
    expect(menu()).toMatch(
      /<button[^>]*disabled=""[^>]*>Cut 2 planets<kbd>Ctrl\+X<\/kbd><\/button>/,
    );

    await flush();
    expect(menu()).toContain('class="keyed">Cut 2 planets<kbd>Ctrl+X</kbd></button>');

    const reason = "Earth has an arc furnace: planets with a megastructure can't move";
    vi.mocked(ipc.planetMoveTargets).mockResolvedValue(
      targets([EARTH, MARS], { refused: [{ planet: EARTH, reason }], systems: [] }),
    );
    useSceneStore.getState().toggleBody(SOL, MARS);
    useSceneStore.getState().toggleBody(SOL, MARS);
    await flush();
    openOn({ kind: "body", system: SOL, id: EARTH });
    expect(menu()).toContain(`title="${escaped(reason)}">Cut 2 planets<kbd>Ctrl+X</kbd></button>`);
  });

  it("puts Paste first on a system's menu, with the first warning under it and all of them on hover", async () => {
    await selectBoth();
    moves().cutSelection();
    useSceneStore.getState().exitScene();

    openOn({ kind: "system", id: CENTAURI });
    let html = menu();
    expect(buttons(html)[0]).toBe("Paste 2 planets here Ctrl+V");
    expect(html).not.toContain("⚠");

    openOn({ kind: "system", id: BARNARD });
    html = menu();
    expect(buttons(html)[0]).toBe(
      "Paste 2 planets here ⚠ Mars will change ownership to Hissman Consciousness about a month after you load (and 1 more) Ctrl+V",
    );
    expect(html).toContain(
      'title="Mars will change ownership to Hissman Consciousness about a month after you load\n' +
        'Earth&#x27;s station will change ownership to Hissman Consciousness"',
    );
  });

  it("refuses a paste back into the planets' own system without asking the core", async () => {
    await selectBoth();
    moves().cutSelection();
    openOn({ kind: "system", id: SOL });
    expect(menu()).toContain(
      'disabled="" title="These planets are already in Sol">Paste 2 planets here<kbd>Ctrl+V</kbd></button>',
    );

    useSceneStore.getState().selectBody(SOL, EARTH);
    await flush();
    moves().cutSelection();
    openOn({ kind: "systemSpace", system: SOL, x: 0, y: 50 });
    expect(menu()).toContain('disabled="" title="Earth is already in Sol">Paste Earth here');
    expect(ipc.planetMoveCheck).not.toHaveBeenCalled();
  });

  it("names the orbit in Paste where the system view's space was pressed", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    await flush();
    moves().cutSelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    const at = { radius: 108, angle: 90 };
    vi.mocked(ipc.planetMoveCheck).mockResolvedValue({ refusal: null, warnings: [] });
    await moves().checkPaste(CENTAURI, at);
    openOn({ kind: "systemSpace", system: CENTAURI, x: 0, y: 108 });
    expect(buttons(menu())[0]).toBe("Paste Earth here (orbit 108 · 90°) Ctrl+V");
  });

  it("names a lone body in its Cut", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    await flush();
    openOn({ kind: "body", system: SOL, id: EARTH });
    expect(menu()).toContain('class="keyed">Cut Earth<kbd>Ctrl+X</kbd></button>');
  });

  it("offers Copy on a body's menu and Paste on a system's, and neither where the save takes no bodies", async () => {
    vi.mocked(ipc.copyBodies).mockResolvedValue([
      { class: "pc_arid" },
      { class: "pc_desert" },
    ] as never);
    await selectBoth();
    const body = { kind: "body", system: SOL, id: EARTH } as const;
    openOn(body);
    expect(menu()).toContain('class="keyed">Copy 2 planets<kbd>Ctrl+C</kbd></button>');
    moves().copySelection();
    await flush();

    openOn({ kind: "system", id: SOL });
    expect(menu()).toContain('class="context-menu-lead keyed">Paste 2 planets here<kbd>');

    useFileSessionStore.setState({
      capabilities: { ...useFileSessionStore.getState().capabilities!, add_bodies: false },
    });
    openOn(body);
    expect(menu()).not.toContain("Copy");
    openOn({ kind: "system", id: SOL });
    expect(menu()).not.toContain("Paste");
  });

  it("offers no Cut or Copy on a ring world segment", async () => {
    const SEGMENT = 14;
    const segment = planetSummary({
      id: SEGMENT,
      name: name("Ring Section"),
      name_key: "Ring Section",
      class: "pc_ringworld_seam",
    });
    inSystem(systemDetails({ id: SOL, planets: [segment] }));
    useSceneStore.getState().selectBody(SOL, SEGMENT);
    await flush();
    openOn({ kind: "body", system: SOL, id: SEGMENT });
    const html = menu();
    expect(html).toContain(">Delete ring world</button>");
    expect(html).not.toContain("Cut");
    expect(html).not.toContain("Copy");
  });

  it("offers no Paste without a cut", () => {
    openOn({ kind: "system", id: CENTAURI });
    expect(menu()).not.toContain("Paste");
    openOn({ kind: "systemSpace", system: SOL, x: 5, y: 5 });
    expect(menu()).not.toContain("Paste");
  });

  it("hides the map's tooltip while a menu is open", () => {
    const tooltip = () => renderToStaticMarkup(<MapTooltip />);
    useMapChromeStore.getState().showTooltip({ x: 0, y: 0, title: "Sol", lines: [] });
    expect(tooltip()).toContain("Sol");
    openOn({ kind: "system", id: SOL });
    expect(tooltip()).toBe("");
  });
});
