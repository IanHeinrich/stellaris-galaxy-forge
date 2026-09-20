import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";
import type { SaveFile } from "../../generated/SaveFile";
import type { ScenarioListing } from "../../generated/ScenarioListing";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import type { SaveRow, ScenarioRow } from "../../lib/openRows";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { useRecentsStore } from "../../store/recentsStore";
import { OpenSave, RowBody } from "./OpenSave";
import { openRoute } from "./openRoute";

function saveFile(over: Partial<SaveFile> = {}): SaveFile {
  return {
    path: "C:/saves/terran/2206.11.16.sav",
    campaign: "terran_1",
    file_name: "2206.11.16.sav",
    meta: {
      name: "Terran Federation",
      date: "2206.11.16",
      version: "Pegasus v4.4.6",
      ironman: false,
      planets: 4,
      fleets: 7,
      color: null,
    },
    modified: 200,
    size: 4096,
    cloud: false,
    ...over,
  };
}

function saveRow(over: Partial<SaveRow> = {}): SaveRow {
  return { kind: "save", key: "save:1", file: saveFile(), empire: "Terran Federation", ...over };
}

function scenarioListing(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return {
    path: "C:/mods/a/map/setup_scenarios/a.txt",
    name: "a_galaxy",
    systems: 100,
    source: "install",
    mod_name: null,
    enabled: true,
    shadowed_by: null,
    modified: 10,
    size: 1024,
    error: null,
    ...over,
  };
}

function scenarioRow(over: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    kind: "scenario",
    key: "scenario:1",
    listing: scenarioListing(),
    group: "Install",
    disabled: false,
    ...over,
  };
}

const noop = () => undefined;

describe("a save row's own scenario action", () => {
  it("renders a ghost 'as scenario' button that opens it as a scenario", () => {
    const row = saveRow();
    const onScenario = vi.fn();
    const tree = <RowBody row={row} onForget={noop} onScenario={onScenario} />;
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("as scenario");
    // Always visible (muted by CSS opacity), not only on hover or the active row.
    expect(html).toContain('class="ghost scenario-action"');

    const button = elements(tree).find(
      (el): el is ReactElement<{ onMouseDown: (e: unknown) => void }> =>
        el.type === "button" && renderToStaticMarkup(el).includes("as scenario"),
    );
    expect(button).toBeDefined();
    button!.props.onMouseDown({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onScenario).toHaveBeenCalledTimes(1);
    expect(onScenario).toHaveBeenCalledWith(row.file.path);
  });
});

describe("a scenario row", () => {
  it("gets no 'as scenario' action of its own", () => {
    const tree = <RowBody row={scenarioRow()} onForget={noop} onScenario={noop} />;
    expect(renderToStaticMarkup(tree)).not.toContain("as scenario");
  });
});

describe("the open screen's footer", () => {
  beforeEach(() => {
    useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
    useGameDataStore.setState({ ...useGameDataStore.getInitialState(), status: "ready" });
    useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
    useRecentsStore.setState({ recents: [] });
    useOpenScreenStore.setState({ ...useOpenScreenStore.getInitialState() });
  });

  it("says in one sentence what opening a save can mean, and names no keys", () => {
    const html = renderToStaticMarkup(<OpenSave modal={false} />);
    expect(html).toContain(
      "A save opens as a save, or as a scenario to start a new campaign from.",
    );
    expect(html).not.toContain("↑↓ move");
    expect(html).not.toContain("Enter opens");
    expect(html).not.toContain("<kbd>");
  });

  it("carries New scenario and Browse as buttons, not as rows at the end of the list", () => {
    const html = renderToStaticMarkup(<OpenSave modal={false} />);
    expect(html).toContain('<button type="button">New scenario…</button>');
    expect(html).toContain('<button type="button">Browse…</button>');
    expect(html).not.toContain("open-row-browse");
    expect(html).not.toContain("open-row-new-scenario");
  });
});

describe("what activating a row does", () => {
  it("asks how to open a save, opens a scenario file at once, and skips the question for the scenario shortcut", () => {
    expect(openRoute("C:/saves/one.sav", false)).toBe("ask");
    expect(openRoute("C:/saves/one.sav", true)).toBe("scenario");
    expect(openRoute("C:/mod/map/setup_scenarios/big.txt", false)).toBe("save");
  });
});
