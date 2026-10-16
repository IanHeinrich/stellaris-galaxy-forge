import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitializerView } from "../../generated/InitializerView";
import { editResult, gameDataSummary, initializerView, SYSTEMS } from "../../store/fixture";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The star icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { RANDOM_KEY, useInitializerBrowserStore } from "../../store/initializerBrowserStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { drawnBrowseKeys, drawnBy, drawnButton, lastDrawn } from "../../test/drawn";
import { shown } from "../../test/elements";
import { mockedIpc } from "../../test/ipc";
import { stubPrefs } from "../../test/prefs";
import { until } from "../../test/wait";
import { InitializerBrowser } from "./Browser";

const VANILLA = "C:/Stellaris/common/solar_system_initializers/";

const entry = (name: string, rest: Partial<InitializerView> = {}): InitializerView =>
  initializerView({ name, source: VANILLA + "misc_system_initializers.txt", ...rest });

const HOME = entry("empire_init_01", { usage: "empire_init", empire_spawn: true });
const SOL = entry("sol_system", { usage: "misc_system_init" });
const BASIC = entry("basic_init_01");
const MANY = Array.from({ length: 14 }, (_, i) => entry(`zz_init_${String(i).padStart(2, "0")}`));
const LIST = [HOME, SOL, BASIC, ...MANY];

const browser = () => useInitializerBrowserStore.getState();

const render = () => drawnBy(() => renderToStaticMarkup(<InitializerBrowser />));

/** The row keys the list drew, in order. */
const rowKeys = (html: string) => [...html.matchAll(/id="ib-row-([^"]+)"/g)].map((m) => m[1]);

type KeyHandler = (e: unknown) => void;

/** Presses `key` in the dialog as the browser stands now, the event aimed at `target`. */
function press(
  key: string,
  { shift = false, ctrl = false, meta = false, target = {} as unknown } = {},
): { preventDefault: ReturnType<typeof vi.fn> } {
  render();
  const onKeyDown = drawnBrowseKeys();
  const event = {
    key,
    shiftKey: shift,
    ctrlKey: ctrl,
    metaKey: meta,
    target,
    preventDefault: vi.fn(),
  };
  onKeyDown(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubPrefs();
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", { activeElement: null });
  mockedIpc.applyOp.mockResolvedValue(editResult());
  useGameDataStore.setState({
    status: "ready",
    summary: gameDataSummary({ install: "C:/Stellaris", mods: [] }),
    initializers: LIST,
    initializersPending: false,
    names: new Map(),
    starClasses: new Map(),
  });
  useGalaxyStore.setState({ galaxy: null, systems: new Map(SYSTEMS.map((s) => [s.id, s])) });
  useMapChromeStore.setState({ highlightInitializer: null });
  useInitializerBrowserStore.setState({
    open: false,
    mode: "assign",
    targets: [],
    pending: null,
    query: "",
    group: null,
    highlighted: null,
    pinned: [],
    recent: [],
    defaultKey: null,
    spawnWeight: null,
  });
});

describe("the dialog", () => {
  it("draws nothing while closed", () => {
    expect(render()).toBe("");
  });

  it("holds the search, the groups, the list, the detail and the foot", () => {
    browser().openFor([0, 2, 3]);
    const html = render();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Choose an initializer"');
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search initializers"');
    expect(html).toContain('placeholder="Search initializers"');
    expect(html).toContain("usage: · mod: · class: · flag: · planets:&gt;5");
    expect(html).toContain('aria-label="Help: Initializers"');
    expect(html).toContain('aria-label="Initializer groups"');
    expect(shown(html)).toContain("All 17");
    expect(html).toContain('role="listbox" aria-label="Initializers"');
    expect(html).toContain('class="browse-detail"');
    expect(html).toContain("Assign to 3 systems");
    expect(html).toContain(
      "Up/Down move · Enter assign · Shift+Enter assign and keep open · Ctrl+D pin · Esc close",
    );
    expect(html.indexOf("Set as default")).toBeLessThan(html.indexOf("☆ Pin"));
    expect(html.indexOf("☆ Pin")).toBeLessThan(html.lastIndexOf(">Assign</button>"));
  });

  it("names the point and the Create action in create mode", () => {
    browser().openToCreate(1, -2.5);
    const html = render();

    expect(html).toContain("New system at 1.00, -2.50");
    expect(html).toContain("Enter create · Shift+Enter create and keep open");
    expect(html).toContain(">Create</button>");
  });

  it("says it is reading until the initializers land", () => {
    useGameDataStore.setState({ initializers: null, initializersPending: true });
    browser().openToCreate(0, 0);
    expect(render()).toContain("Reading the initializers…");
  });

  it("says so when the search matches nothing", () => {
    browser().openToCreate(0, 0);
    browser().setQuery("no_such_thing");
    browser().setGroup("empire");
    expect(render()).toContain("Nothing matches that search.");
  });

  it("caps the list and counts the rows it left out", () => {
    const long = Array.from({ length: 305 }, (_, i) => entry(`init_${String(i).padStart(3, "0")}`));
    useGameDataStore.setState({ initializers: long });
    browser().openToCreate(0, 0);
    const html = render();

    expect(rowKeys(html)).toHaveLength(300);
    expect(rowKeys(html)[0]).toBe(RANDOM_KEY);
    expect(html).toContain("6 more — refine the search.");
  });
});

describe("the keys", () => {
  let keys: string[];

  beforeEach(() => {
    browser().openToCreate(0, 0);
    keys = rowKeys(render());
    expect(keys).toHaveLength(LIST.length + 1);
    browser().highlight(keys[0]);
  });

  it("move the highlight a row, a page and to either end", () => {
    const at = () => keys.indexOf(browser().highlighted ?? "");
    expect(at()).toBe(0);

    expect(press("ArrowDown").preventDefault).toHaveBeenCalled();
    expect(at()).toBe(1);
    press("ArrowUp");
    expect(at()).toBe(0);
    press("ArrowUp");
    expect(at()).toBe(0);
    press("PageDown");
    expect(at()).toBe(10);
    press("PageDown");
    expect(at()).toBe(keys.length - 1);
    press("PageUp");
    expect(at()).toBe(keys.length - 11);
    press("Home");
    expect(at()).toBe(0);
    press("End");
    expect(at()).toBe(keys.length - 1);
  });

  it("leave a key the list does not move on alone", () => {
    expect(press("x").preventDefault).not.toHaveBeenCalled();
    expect(browser().highlighted).toBe(RANDOM_KEY);
  });

  it("leave Home and End typed in the search to the field", () => {
    press("ArrowDown");
    // The static renderer attaches no ref, so the search's own ref is null.
    expect(press("Home", { target: null }).preventDefault).not.toHaveBeenCalled();
    expect(press("End", { target: null }).preventDefault).not.toHaveBeenCalled();
    expect(browser().highlighted).toBe(keys[1]);

    press("ArrowDown", { target: null });
    expect(browser().highlighted).toBe(keys[2]);
  });

  it("leave keys typed into another field alone", () => {
    const field = Object.assign(new (globalThis.HTMLElement as unknown as new () => object)(), {
      tagName: "INPUT",
    });
    press("ArrowDown", { target: field });
    press("Enter", { target: field });
    expect(browser().highlighted).toBe(RANDOM_KEY);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("Enter creates and closes; Shift+Enter keeps the browser open", async () => {
    browser().highlight(SOL.name);
    press("Enter", { shift: true });
    await until(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1));
    expect(browser().open).toBe(true);
    expect(browser().recent).toEqual([SOL.name]);

    press("Enter");
    await until(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(2));
    await until(() => expect(browser().open).toBe(false));
  });

  it("Ctrl+D pins and unpins the highlighted row, and never random", () => {
    expect(press("d", { ctrl: true }).preventDefault).toHaveBeenCalled();
    expect(browser().pinned).toEqual([]);

    browser().highlight(SOL.name);
    press("D", { ctrl: true });
    expect(browser().pinned).toEqual([SOL.name]);
    press("d", { meta: true });
    expect(browser().pinned).toEqual([]);

    expect(press("ArrowDown", { ctrl: true }).preventDefault).not.toHaveBeenCalled();
    expect(browser().highlighted).toBe(SOL.name);
  });
});

describe("the buttons", () => {
  beforeEach(() => {
    const systems = new Map(useGalaxyStore.getState().systems);
    systems.set(2, { ...systems.get(2)!, initializer: SOL.name });
    useGalaxyStore.setState({ systems });
    browser().openFor([2]);
    expect(browser().highlighted).toBe(SOL.name);
  });

  it("pin the highlighted row from the foot and from the row", () => {
    render();
    drawnButton("☆ Pin").onClick();
    expect(browser().pinned).toEqual([SOL.name]);

    render();
    drawnButton(`Unpin ${SOL.name}`).onClick();
    expect(browser().pinned).toEqual([]);
  });

  it("set and clear this machine's default", () => {
    render();
    drawnButton("Set as default").onClick();
    expect(browser().defaultKey).toBe(SOL.name);

    render();
    drawnButton("Clear default").onClick();
    expect(browser().defaultKey).toBe(null);
  });

  it("assign the highlighted row", async () => {
    render();
    drawnButton("Assign").onClick();
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith({
        type: "SetInitializer",
        system: 2,
        initializer: SOL.name,
      }),
    );
  });

  it("close the browser", () => {
    render();
    drawnButton("Close").onClick();
    expect(browser().open).toBe(false);
  });
});

describe("the rows and the search", () => {
  const row = (key: string) =>
    lastDrawn(
      ({ type, props }) => type === "div" && props.id === `ib-row-${key}`,
      `row ${key}`,
    ) as { onMouseDown(e: unknown): void; onDoubleClick(): void };

  beforeEach(() => {
    browser().openFor([2]);
    browser().highlight(RANDOM_KEY);
  });

  it("highlight a row on mouse down, keeping the focus where it is", () => {
    render();
    const e = { preventDefault: vi.fn() };
    row(SOL.name).onMouseDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(browser().highlighted).toBe(SOL.name);
  });

  it("assign a row on double click and close", async () => {
    browser().highlight(SOL.name);
    render();
    row(SOL.name).onDoubleClick();
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenCalledWith({
        type: "SetInitializer",
        system: 2,
        initializer: SOL.name,
      }),
    );
    await until(() => expect(browser().open).toBe(false));
  });

  it("send what is typed in the search to the query", () => {
    render();
    const search = lastDrawn(
      ({ type, props }) => type === "input" && props.type === "search",
      "the search",
    ) as { onChange(e: unknown): void };
    search.onChange({ currentTarget: { value: "sol" } });
    expect(browser().query).toBe("sol");
  });
});

describe("the group tree", () => {
  const tree = () =>
    lastDrawn(
      ({ props }) => props.role === "listbox" && props["aria-label"] === "Initializer groups",
      "the group tree",
    ) as { onKeyDown: KeyHandler };

  it("selects a group by its button and moves between them with the arrows", () => {
    browser().openToCreate(0, 0);
    render();
    tree().onKeyDown({ key: "ArrowDown", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    const first = browser().group;
    expect(first).not.toBe(null);

    render();
    tree().onKeyDown({ key: "Home", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(browser().group).toBe(null);

    render();
    const groupButton = lastDrawn(
      ({ type, props }) => type === "button" && props.role === "option",
      "a group",
    ) as { onClick(): void };
    groupButton.onClick();
    expect(browser().group).not.toBe(null);
    expect(browser().group).not.toBe(first);
  });
});
