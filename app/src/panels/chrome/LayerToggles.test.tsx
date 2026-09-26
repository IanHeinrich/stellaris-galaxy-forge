import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import {
  NO_GAME_DATA_KEYS_TITLE,
  NO_GAME_DATA_TITLE,
  SOURCES,
  SOURCE_LABELS,
  type Source,
} from "../../lib/visual/layerGroups";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { readyAs } from "../../test/session";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSceneStore } from "../../store/sceneStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { openWith } from "../../test/session";
import { LayersMenu, LayersMenuBody } from "./LayersMenu";
import { LayerToggles } from "./LayerToggles";

const bar = () => renderToStaticMarkup(<LayerToggles />);
const menu = () => renderToStaticMarkup(<LayersMenu />);
const menuBody = () => renderToStaticMarkup(<LayersMenuBody />);

/** The label of every button in `html`. */
const buttonLabels = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);

/** The name of every layer row in the menu's `html`, the reset left out. */
const rowNames = (html: string) =>
  [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .map((row) => /<span>([^<]*)<\/span>/.exec(row[0])?.[1])
    .filter((name): name is string => name !== undefined);

/** A group's name as the markup carries it, where `&` is an entity. */
const label = (source: Source) => SOURCE_LABELS[source].replace("&", "&amp;");

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the split layer bar", () => {
  it("frames a scenario's toggles in the three sources, the file's first", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    for (const source of SOURCES) expect(html).toContain(`aria-label="${label(source)}"`);
    expect(html.indexOf(label("scenario"))).toBeLessThan(html.indexOf(label("initializers")));
    expect(html.indexOf(label("initializers"))).toBeLessThan(html.indexOf(label("scripts")));
    expect(html).toContain("Spawn points");
    expect(html).toContain('class="layer-group init"');
    expect(html).toContain('class="layer-group src"');
  });

  it("gives each master a pill of its own rather than one more layer icon", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    expect(html).toContain('class="master init"');
    expect(html).toContain('class="master src"');
    expect(html).not.toContain('class="icon init" aria-label="Initializers"');
    expect(html).not.toContain('class="icon src" aria-label="Scripts"');
  });

  it("closes the initializers frame with Empires, after the kinds it also decides", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    const empires = html.indexOf('aria-label="Empires"');
    expect(html.indexOf('aria-label="System details"')).toBeLessThan(empires);
    expect(html.indexOf('aria-label="Leviathans"')).toBeLessThan(empires);
    expect(html.indexOf('aria-label="Enclaves"')).toBeLessThan(empires);
    expect(html.indexOf(label("scripts"))).toBeGreaterThan(empires);
  });

  it("carries the nebulae after the spawn points, in the scenario's own frame", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    const nebulae = html.indexOf('aria-label="Nebulae"');
    expect(html.indexOf('aria-label="Spawn points"')).toBeLessThan(nebulae);
    expect(nebulae).toBeLessThan(html.indexOf(label("initializers")));
  });

  it("carries the master and the icons of every group the scripts and the keys decide", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    expect(html).toContain('aria-label="Scripts" aria-pressed');
    expect(html).toContain('aria-label="Day-one claims"');
    expect(html).toContain('aria-label="Day-one bypasses"');
    expect(html).toContain('aria-label="Bypasses"');
    expect(html).toContain('aria-label="System details"');
    expect(html).toContain('aria-label="Empires"');
    expect(html).toContain('aria-label="Leviathans"');
  });

  it("a group off leaves its kinds reading as off, not as the user's own choice", () => {
    readyAs(SCENARIO_RESULT);
    useMapChromeStore.getState().toggleKind("landmark");
    useMapChromeStore.getState().toggleGroup("initializers");

    const html = bar();
    expect(html).toContain('aria-label="Initializers" aria-pressed="false"');
    expect(html).toContain('aria-label="Leviathans" aria-pressed="false"');
    expect(html).toContain('aria-label="Enclaves" aria-pressed="false"');
    expect(html).toContain('aria-label="System details" aria-pressed="false"');
    // The kinds only the menu lists are the user's own, so the group leaves them alone.
    expect(useMapChromeStore.getState().shownKinds.has("landmark")).toBe(true);
  });

  it("the pill reads how much of the group's own icons the map draws", () => {
    readyAs(SCENARIO_RESULT);
    const chrome = () => useMapChromeStore.getState();
    expect(bar()).toContain('aria-label="Initializers" aria-pressed="true"');
    expect(bar()).toContain('aria-label="Scripts" aria-pressed="false"');

    // A layer only the menu carries is none of the pill's business.
    chrome().toggleLayer("colonies");
    expect(bar()).toContain('aria-label="Initializers" aria-pressed="true"');

    chrome().toggleLayer("details");
    expect(bar()).toContain('aria-label="Initializers" aria-pressed="mixed"');

    chrome().toggleGroup("initializers");
    expect(bar()).toContain('aria-label="Initializers" aria-pressed="false"');
  });

  it("heads the two groups the install decides with a master of their own", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    const masters = html.match(/aria-label="(Initializers|Scripts)" aria-pressed/g);
    expect(masters).toHaveLength(2);
    // The scenario is the document itself, so nothing switches it off.
    expect(html).not.toContain('aria-label="Scenario" aria-pressed');
  });

  it("says why each master is dead until the install has been read, in its own words", () => {
    readyAs(SCENARIO_RESULT);

    const html = bar();
    expect(html).toContain(NO_GAME_DATA_KEYS_TITLE);
    expect(html).toContain(NO_GAME_DATA_TITLE);
  });

  it("leaves a save the one bar it has always had", () => {
    readyAs(OPEN_RESULT);

    const html = bar();
    for (const source of SOURCES) expect(html).not.toContain(`aria-label="${label(source)}"`);
    expect(html).not.toContain("layer-group");
    expect(html).not.toContain("Spawn points");
    expect(menu()).not.toContain("Everything from");
  });

  it("gives a save's flat bar the nebulae last, after the bypasses", () => {
    readyAs(OPEN_RESULT);

    const html = bar();
    const nebulae = html.indexOf('aria-label="Nebulae"');
    expect(html.indexOf('aria-label="Bypasses"')).toBeLessThan(nebulae);
    expect(html.indexOf('aria-label="Empires"')).toBeLessThan(nebulae);
    expect(html.indexOf('aria-label="Leviathans"')).toBeGreaterThan(nebulae);
  });

  it("shows only Names, System details, Nebulae and Orbit radii while a system is shown, none greyed", async () => {
    resetStores();
    armSession();
    await openWith(OPEN_RESULT);
    const scene = ["Names", "Nebulae", "Orbit radii", "System details"];
    expect(bar()).not.toContain("disabled");
    expect(buttonLabels(bar())).toEqual(expect.arrayContaining(["Hyperlanes", "Leviathans"]));
    expect(buttonLabels(bar())).not.toContain("Orbit radii");
    expect(rowNames(menuBody())).toEqual(expect.arrayContaining(["Systems", "Hyperlanes"]));
    expect(rowNames(menuBody())).not.toContain("Orbit radii");
    expect(menuBody()).toContain("<span>Systems</span><kbd>2</kbd>");

    useSceneStore.getState().enterSystem(0);
    expect(buttonLabels(bar()).sort()).toEqual(scene);
    expect(bar()).not.toContain("disabled");
    expect(rowNames(menuBody()).sort()).toEqual(scene);
    expect(menuBody()).not.toContain("disabled");
    expect(menuBody()).toContain("<span>Orbit radii</span><kbd>2</kbd>");

    useMapChromeStore.setState((s) => ({
      layers: { ...s.layers, details: true },
      sceneLayers: { ...s.sceneLayers, details: false },
    }));
    expect(bar()).toMatch(/aria-label="System details" aria-pressed="false"/);

    useSceneStore.getState().leaveSystem();
    expect(bar()).toMatch(/aria-label="System details" aria-pressed="true"/);
    expect(buttonLabels(bar())).toContain("Hyperlanes");
  });

  it("drops a scenario's masters while a system is shown, and keeps its frames' own reasons", async () => {
    resetStores();
    armSession();
    await openWith(SCENARIO_RESULT);
    expect(buttonLabels(bar())).toEqual(expect.arrayContaining(["Initializers", "Scripts"]));
    expect(menuBody()).toContain("master-pill init");

    useSceneStore.getState().enterSystem(0);
    const html = bar();
    expect(buttonLabels(html).sort()).toEqual([
      "Names",
      "Nebulae",
      "Orbit radii",
      "System details",
    ]);
    expect(html).not.toContain(`aria-label="${label("scripts")}"`);
    expect(menuBody()).not.toContain("master-pill");
    expect(html).toMatch(
      new RegExp(`aria-label="System details"[^>]*disabled[^>]*title="${NO_GAME_DATA_KEYS_TITLE}"`),
    );
  });

  it("carries nothing to toggle until a document is open", () => {
    expect(useFileSessionStore.getState().status).toBe("empty");
    expect(bar()).toBe("");
    expect(menu()).toBe("");

    readyAs(SCENARIO_RESULT);
    expect(bar()).not.toBe("");
    expect(menu()).toContain("Layers");
  });
});
