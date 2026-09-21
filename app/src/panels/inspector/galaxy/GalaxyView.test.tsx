import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeaderField } from "../../../generated/HeaderField";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import { onProgress } from "../../../api/events";
import * as ipc from "../../../api/ipc";
import { bindStores } from "../../../store/bindStores";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import {
  editResult,
  OPEN_RESULT,
  SCENARIO_BYPASSES,
  SCENARIO_RESULT,
} from "../../../store/fixture";
import { GalaxyView } from "./GalaxyView";
import {
  CLEAR_KEY_TITLE,
  CLEAR_RANGE_TITLE,
  LOAD_SHAPES_HINT,
  NO_SHAPES_HINT,
  RAW_CELL_TITLE,
  SCRIPTS_LINE_TITLE,
  SHAPES_TITLE,
} from "./gameSetup";
import { addHeaderField, DUPLICATE_KEY_TITLE, removeHeaderField, setHeaderField } from "./header";

const mocked = {
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
  applyOp: vi.mocked(ipc.applyOp),
  onProgress: vi.mocked(onProgress),
};

/** A header as a scenario writes one: a name, its shapes, and a key the file states twice. */
const HEADER: HeaderField[] = [
  { key: "name", value: '"My Galaxy"', line: 2 },
  { key: "supports_shape", value: "elliptical", line: 5 },
  { key: "supports_shape", value: "ring", line: 6 },
  { key: "priority", value: "1", line: 7 },
  { key: "priority", value: "2", line: 8 },
];

const shape = (name: string) => ({ name, source: `C:/Stellaris/map/galaxy/${name}.txt` });
const SHAPES = [shape("elliptical"), shape("ring"), shape("spiral_2")];

/** The counts the new-game screen reads: a clean range, a default past it, and a scripted max. */
const SETUP_HEADER: HeaderField[] = [
  ...HEADER,
  { key: "num_empires", value: "{ min = 0 max = 3 }", line: 9 },
  { key: "num_empire_default", value: "5", line: 10 },
  { key: "fallen_empire_max", value: "4", line: 11 },
  { key: "num_gateways", value: "{ min = 0 max = @gw }", line: 12 },
];

bindStores();

beforeEach(() => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useInspectorStore.setState({ ...useInspectorStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  mocked.onProgress.mockResolvedValue(() => undefined);
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.openAsScenario.mockResolvedValue({
    ...SCENARIO_RESULT,
    galaxy: { ...SCENARIO_RESULT.galaxy, header: HEADER },
  });
  mocked.applyOp.mockResolvedValue(editResult());
});

const galaxy = () => renderToStaticMarkup(<GalaxyView />);

async function open(kind: "save" | "scenario"): Promise<void> {
  const session = useFileSessionStore.getState();
  await (kind === "save"
    ? session.openSave(OPEN_RESULT.path)
    : session.openScenarioFrom(SCENARIO_RESULT.path));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the bypasses a scenario places", () => {
  it("counts the drawn ones and says under the bypass rows how many the scripts add", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });

    const html = galaxy();
    expect(html).toContain(">Bypasses</span><span>3</span>");
    const line = html.indexOf(
      `<div class="muted ins-hint ins-setup-note" title="${SCRIPTS_LINE_TITLE.replace("'", "&#x27;")}">Also from scripts: 3 wormhole pairs and 1 gateway placed at random on day one</div>`,
    );
    expect(line).toBeGreaterThan(html.indexOf("Gateways default"));
    expect(line).toBeLessThan(html.indexOf("Hyperlane density"));
  });

  it("says nothing about random ones on a save, whose file states every bypass it has", async () => {
    await open("save");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });

    expect(galaxy()).not.toContain("placed at random");
  });
});

describe("the scenario header", () => {
  it("lists every key the file states, and edits only the first statement of a repeated one", async () => {
    await open("scenario");

    const html = galaxy();
    expect(html).toContain("Scenario header · 3");
    expect(html).toContain('aria-label="name value"');
    expect(html).toContain("&quot;My Galaxy&quot;");
    expect(html).toContain('aria-label="Remove name"');
    // The op names a key and the core rewrites its first statement, so the second row is inert.
    expect(count(html, 'aria-label="priority value"')).toBe(1);
    expect(count(html, 'aria-label="Remove priority"')).toBe(1);
    expect(html).toContain('value="1"');
    expect(html).toContain(`title="${DUPLICATE_KEY_TITLE}"`);
    expect(html).toContain(">2<");
  });

  it("offers a key and a value to add, and refuses an empty key and one already stated", async () => {
    await open("scenario");

    const html = galaxy();
    expect(html).toContain('aria-label="New key"');
    expect(html).toContain('aria-label="New value"');
    expect(html).toContain("disabled=");
    expect(addHeaderField(HEADER, "", "elliptical")).toBeNull();
    expect(addHeaderField(HEADER, "  supports_shape ", "ring")).toBeNull();
    expect(addHeaderField(HEADER, "  seed ", " 42 ")).toEqual({
      type: "SetHeaderField",
      key: "seed",
      value: "42",
    });
  });

  it("writes the value a row commits and drops the key its × sends", async () => {
    await open("scenario");

    await useEditorStore.getState().applyOp(setHeaderField("name", ' "Other Galaxy" '));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetHeaderField",
      key: "name",
      value: '"Other Galaxy"',
    });

    await useEditorStore.getState().applyOp(removeHeaderField("priority"));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetHeaderField",
      key: "priority",
      value: null,
    });
  });

  it("stays away from a save, which has no header of its own", async () => {
    await open("save");

    expect(galaxy()).not.toContain("Scenario header");
  });

  it("says nothing about the mod's listing or the seats for a plain scenario", async () => {
    await open("scenario");

    const html = galaxy();
    expect(html).not.toContain("Listed in-game as a galaxy size");
    expect(html).not.toContain("Seats");
    expect(html).not.toContain("Fit fallen empire zones");
  });

  it("names the size the mod lists the scenario under, and sums up its scripted seats", async () => {
    mocked.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: HEADER,
        systems: [
          ...SCENARIO_RESULT.galaxy.systems.slice(0, 4),
          {
            ...SCENARIO_RESULT.galaxy.systems[4],
            spawn_script: { paint_a_galaxy: { kind: "preferred", random_value: 1 } },
          },
          {
            ...SCENARIO_RESULT.galaxy.systems[5],
            spawn_script: { paint_a_galaxy: { kind: { reserved: "b" }, random_value: 2 } },
          },
        ],
      },
    });
    await open("scenario");

    const html = galaxy();
    expect(html).toContain(
      "Listed in-game as a galaxy size. Start a new game with the Elliptical shape and this size.",
    );
    expect(html).toContain("Seats 2 · preferred 1 · reserved B");
    expect(html).toContain(">Fit fallen empire zones…</button>");
  });
});

describe("the game setup grid", () => {
  const cell = (label: string, title: string, value: string) =>
    `aria-label="${label}" placeholder="–" title="${title}" value="${value}"`;
  const bound = (label: string, value: string) => cell(label, CLEAR_RANGE_TITLE, value);
  const count = (label: string, value: string) => cell(label, CLEAR_KEY_TITLE, value);

  async function openSetup(): Promise<string> {
    mocked.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      galaxy: { ...SCENARIO_RESULT.galaxy, header: SETUP_HEADER },
    });
    await open("scenario");
    return galaxy();
  }

  it("fills each cell from the header, and leaves a missing key's cell empty", async () => {
    const html = await openSetup();
    expect(html).toContain("Game setup");
    expect(html).toContain(bound("AI empires min", "0"));
    expect(html).toContain(bound("AI empires max", "3"));
    expect(html).toContain(count("AI empires default", "5"));
    expect(html).toContain(count("Fallen empires max", "4"));
    expect(html).toContain(count("Fallen empires default", ""));
    expect(html).not.toContain('aria-label="Advanced starts max"');
  });

  it("shows a range with a scripted constant as text and leaves it to the raw list", async () => {
    const html = await openSetup();
    expect(html).toContain(`title="${RAW_CELL_TITLE}"`);
    expect(html).toContain(">{ min = 0 max = @gw }<");
    expect(html).not.toContain('aria-label="Gateways min"');
    expect(html).toContain('aria-label="num_gateways value"');
  });

  it("hides the keys it edits from the raw list, which still refuses them as taken", async () => {
    const html = await openSetup();
    expect(html).toContain("Scenario header · 4");
    expect(html).not.toContain('aria-label="num_empires value"');
    expect(html).not.toContain('aria-label="num_empire_default value"');
    expect(html).not.toContain('aria-label="fallen_empire_max value"');
    expect(addHeaderField(SETUP_HEADER, "num_empires", "{ min = 1 max = 2 }")).toBeNull();
  });

  it("warns of a default outside its range", async () => {
    const html = await openSetup();
    expect(html).toContain('<div class="ins-warn">AI empires · Default 5 is outside 0–3</div>');
    expect(html).not.toContain("Max is below min");
  });

  it("drops a key when its cell is cleared, the whole range for a bound", async () => {
    const html = await openSetup();
    expect(html).toContain(bound("Wormhole pairs min", ""));
    expect(html).toContain(count("Gateways default", ""));

    await useEditorStore.getState().applyOp(removeHeaderField("num_empires"));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetHeaderField",
      key: "num_empires",
      value: null,
    });
  });

  it("keeps the count controls under the paint gate", async () => {
    const html = await openSetup();
    expect(html).not.toContain("Update counts");
    expect(html).not.toContain("Fit fallen empire zones");
  });
});

describe("the shapes row", () => {
  const box = (name: string, ticked: boolean) =>
    `<input type="checkbox" aria-label="${name} shape"${ticked ? ' checked=""' : ""}/>`;

  it("ticks the game data's shapes the header lists and keeps them out of the raw list", async () => {
    await open("scenario");
    useGameDataStore.setState({ status: "ready", galaxyShapes: SHAPES });

    const html = galaxy();
    expect(html).toContain(`title="${SHAPES_TITLE}"`);
    expect(html).toContain("Listed under shapes");
    expect(html).toContain(box("elliptical", true));
    expect(html).toContain(box("ring", true));
    expect(html).toContain(box("spiral_2", false));
    expect(html).not.toContain("not in loaded game data");
    expect(html).not.toContain(LOAD_SHAPES_HINT);
    expect(html).not.toContain(NO_SHAPES_HINT);
    expect(html).not.toContain('aria-label="supports_shape value"');
    expect(html).not.toContain('aria-label="Remove supports_shape"');
  });

  it("marks a shape the header lists that the game data lacks", async () => {
    mocked.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [...HEADER, { key: "supports_shape", value: "paint_custom", line: 9 }],
      },
    });
    await open("scenario");
    useGameDataStore.setState({ status: "ready", galaxyShapes: SHAPES });

    const html = galaxy();
    expect(html).toContain(
      `${box("paint_custom", true)}<span class="mono">paint_custom</span><span class="muted"> (not in loaded game data)</span>`,
    );
    expect(html.indexOf("paint_custom")).toBeGreaterThan(html.indexOf('"spiral_2 shape"'));
  });

  it("offers the header's own names alone without game data, and asks for it", async () => {
    await open("scenario");

    const html = galaxy();
    expect(html).toContain(box("elliptical", true));
    expect(html).toContain(box("ring", true));
    expect(html).not.toContain("spiral_2");
    expect(html).toContain(LOAD_SHAPES_HINT);
  });

  it("warns when no shape is ticked", async () => {
    mocked.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      galaxy: { ...SCENARIO_RESULT.galaxy, header: [HEADER[0]] },
    });
    await open("scenario");
    useGameDataStore.setState({ status: "ready", galaxyShapes: SHAPES });

    const html = galaxy();
    expect(html).toContain(box("elliptical", false));
    expect(html).toContain(`<div class="ins-warn">${NO_SHAPES_HINT}</div>`);
  });

  it("writes the whole list when a box is toggled", async () => {
    await open("scenario");

    await useEditorStore
      .getState()
      .applyOp({ type: "SetHeaderList", key: "supports_shape", values: ["elliptical"] });
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetHeaderList",
      key: "supports_shape",
      values: ["elliptical"],
    });
  });
});
