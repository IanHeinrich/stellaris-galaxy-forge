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
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { LayersMenu } from "./LayersMenu";
import { LayerToggles } from "./LayerToggles";

const bar = () => renderToStaticMarkup(<LayerToggles />);
const menu = () => renderToStaticMarkup(<LayersMenu />);

/** A group's name as the markup carries it, where `&` is an entity. */
const label = (source: Source) => SOURCE_LABELS[source].replace("&", "&amp;");

function open(result: typeof OPEN_RESULT): void {
  useFileSessionStore.setState({
    status: "ready",
    kind: result.kind,
    capabilities: result.capabilities,
  });
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the split layer bar", () => {
  it("frames a scenario's toggles in the three sources, the file's first", () => {
    open(SCENARIO_RESULT);

    const html = bar();
    for (const source of SOURCES) expect(html).toContain(`aria-label="${label(source)}"`);
    expect(html.indexOf(label("scenario"))).toBeLessThan(html.indexOf(label("initializers")));
    expect(html.indexOf(label("initializers"))).toBeLessThan(html.indexOf(label("scripts")));
    expect(html).toContain("Spawn points");
    expect(html).toContain('class="layer-group init"');
    expect(html).toContain('class="layer-group src"');
  });

  it("gives each master a pill of its own rather than one more layer icon", () => {
    open(SCENARIO_RESULT);

    const html = bar();
    expect(html).toContain('class="master init"');
    expect(html).toContain('class="master src"');
    expect(html).not.toContain('class="icon init" aria-label="Initializers"');
    expect(html).not.toContain('class="icon src" aria-label="Scripts"');
  });

  it("closes the initializers frame with Empires, after the kinds it also decides", () => {
    open(SCENARIO_RESULT);

    const html = bar();
    const empires = html.indexOf('aria-label="Empires"');
    expect(html.indexOf('aria-label="System details"')).toBeLessThan(empires);
    expect(html.indexOf('aria-label="Leviathans"')).toBeLessThan(empires);
    expect(html.indexOf('aria-label="Enclaves"')).toBeLessThan(empires);
    expect(html.indexOf(label("scripts"))).toBeGreaterThan(empires);
  });

  it("carries the nebulae after the spawn points, in the scenario's own frame", () => {
    open(SCENARIO_RESULT);

    const html = bar();
    const nebulae = html.indexOf('aria-label="Nebulae"');
    expect(html.indexOf('aria-label="Spawn points"')).toBeLessThan(nebulae);
    expect(nebulae).toBeLessThan(html.indexOf(label("initializers")));
  });

  it("carries the master and the icons of every group the scripts and the keys decide", () => {
    open(SCENARIO_RESULT);

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
    open(SCENARIO_RESULT);
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
    open(SCENARIO_RESULT);
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
    open(SCENARIO_RESULT);

    const html = bar();
    const masters = html.match(/aria-label="(Initializers|Scripts)" aria-pressed/g);
    expect(masters).toHaveLength(2);
    // The scenario is the document itself, so nothing switches it off.
    expect(html).not.toContain('aria-label="Scenario" aria-pressed');
  });

  it("says why each master is dead until the install has been read, in its own words", () => {
    open(SCENARIO_RESULT);

    const html = bar();
    expect(html).toContain(NO_GAME_DATA_KEYS_TITLE);
    expect(html).toContain(NO_GAME_DATA_TITLE);
  });

  it("leaves a save the one bar it has always had", () => {
    open(OPEN_RESULT);

    const html = bar();
    for (const source of SOURCES) expect(html).not.toContain(`aria-label="${label(source)}"`);
    expect(html).not.toContain("layer-group");
    expect(html).not.toContain("Spawn points");
    expect(menu()).not.toContain("Everything from");
  });

  it("gives a save's flat bar the nebulae last, after the bypasses", () => {
    open(OPEN_RESULT);

    const html = bar();
    const nebulae = html.indexOf('aria-label="Nebulae"');
    expect(html.indexOf('aria-label="Bypasses"')).toBeLessThan(nebulae);
    expect(html.indexOf('aria-label="Empires"')).toBeLessThan(nebulae);
    expect(html.indexOf('aria-label="Leviathans"')).toBeGreaterThan(nebulae);
  });

  it("carries nothing to toggle until a document is open", () => {
    expect(useFileSessionStore.getState().status).toBe("empty");
    expect(bar()).toBe("");
    expect(menu()).toBe("");

    open(SCENARIO_RESULT);
    expect(bar()).not.toBe("");
    expect(menu()).toContain("Layers");
  });
});
