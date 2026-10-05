import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeaderField } from "../../../generated/HeaderField";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { usePrepareStore } from "../../../store/prepareStore";
import { armSession, resetStores } from "../../../store/storeFixture";
import { drawnBy, drawnButton, drawnField, lastDrawn } from "../../../test/drawn";
import { TextField } from "../../EditField";
import { editResult, OPEN_RESULT, SCENARIO_RESULT } from "../../../store/fixture";
import { GalaxyView } from "./GalaxyView";
import {
  CLEAR_KEY_TITLE,
  CLEAR_RANGE_TITLE,
  LOAD_SHAPES_HINT,
  NO_SHAPES_HINT,
  RAW_CELL_TITLE,
  SHAPES_TITLE,
} from "./gameSetup";
import { addHeaderField, DUPLICATE_KEY_TITLE, HEADER_KEY_NOTES, NAME_HINT } from "./header";
import { mockedIpc } from "../../../test/ipc";
import { until } from "../../../test/wait";

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
  resetStores();
  armSession();
  mockedIpc.openAsScenario.mockResolvedValue({
    ...SCENARIO_RESULT,
    galaxy: { ...SCENARIO_RESULT.galaxy, header: HEADER },
  });
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

const galaxy = () => renderToStaticMarkup(<GalaxyView />);

/** Opens the sample save, or takes it as a scenario past its setup screen with the header open. */
async function open(kind: "save" | "scenario"): Promise<void> {
  const session = useFileSessionStore.getState();
  await (kind === "save"
    ? session.openSave(OPEN_RESULT.path)
    : session.openScenarioFrom(SCENARIO_RESULT.path));
  if (kind === "save") return;
  usePrepareStore.setState({ dismissed: true });
  useInspectorStore.getState().toggleSection("galaxy.header", true);
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the scenario header", () => {
  it("starts closed", async () => {
    await open("scenario");
    useInspectorStore.getState().resetSections(["galaxy.header"]);
    const html = galaxy();
    expect(html).toContain("Scenario header · 2");
    expect(html).not.toContain('aria-label="New key"');
  });

  it("lists every key but the name, and edits only the first statement of a repeated one", async () => {
    await open("scenario");

    const html = galaxy();
    expect(html).toContain("Scenario header · 2");
    expect(html).not.toContain('aria-label="name value"');
    expect(html).not.toContain('aria-label="Remove name"');
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

    drawnBy(galaxy);
    const value = drawnField(TextField, "priority value") as { onCommit(value: string): void };
    value.onCommit(" 3 ");
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetHeaderField",
        key: "priority",
        value: "3",
      }),
    );

    drawnButton("Remove priority").onClick();
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetHeaderField",
        key: "priority",
        value: null,
      }),
    );
  });

  it("stays away from a save, which has no header of its own", async () => {
    await open("save");

    expect(galaxy()).not.toContain("Scenario header");
  });

  it("says under the keys the game reads its own way what each does, and nothing under others", async () => {
    mockedIpc.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [...HEADER, { key: "random_hyperlanes", value: "no", line: 9 }],
      },
    });
    await open("scenario");

    const html = galaxy();
    expect(html).toContain(HEADER_KEY_NOTES.random_hyperlanes.replace("'", "&#x27;"));
    const priority = html.slice(html.indexOf('aria-label="Remove priority"'));
    expect(priority.slice(0, priority.indexOf("ins-header-row"))).not.toContain("ins-hint");
  });

  it("keeps a repeated name in the list as an inert row", async () => {
    mockedIpc.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [...HEADER, { key: "name", value: '"Second"', line: 9 }],
      },
    });
    await open("scenario");

    const html = galaxy();
    expect(html).toContain("Scenario header · 3");
    expect(html).toContain(
      `<div class="ins-header-row repeated" title="${DUPLICATE_KEY_TITLE}"><span class="k mono">name</span>`,
    );
    expect(html).not.toContain('aria-label="name value"');
  });

  it("names the map in a Name field at the top of the page, which writes the header", async () => {
    await open("scenario");

    const html = drawnBy(galaxy);
    expect(html.indexOf(NAME_HINT)).toBeLessThan(html.indexOf("Prepare for a new game"));
    const name = drawnField(TextField, "Name") as { value: string; onCommit(value: string): void };
    expect(name.value).toBe("My Galaxy");
    name.onCommit(" Other Galaxy ");
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetHeaderField",
        key: "name",
        value: '"Other Galaxy"',
      }),
    );
  });

  it("says nothing about the seats for a plain scenario", async () => {
    await open("scenario");

    const html = galaxy();
    expect(html).not.toContain("Seats");
    expect(html).not.toContain("Fit fallen empire zones");
  });

  it("names the size the mod lists the scenario under, and sums up its scripted seats", async () => {
    mockedIpc.openAsScenario.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: HEADER,
        systems: [
          ...SCENARIO_RESULT.galaxy.systems.slice(0, 4),
          {
            ...SCENARIO_RESULT.galaxy.systems[4],
            spawn_script: { paint_a_galaxy: { kind: "preferred", random_value: 1, player: false } },
          },
          {
            ...SCENARIO_RESULT.galaxy.systems[5],
            spawn_script: {
              paint_a_galaxy: { kind: { reserved: "b" }, random_value: 2, player: false },
            },
          },
        ],
      },
    });
    await open("scenario");

    const html = galaxy();
    expect(html).toContain(NAME_HINT);
    expect(html).toContain("Seats 2 · 1st Player 1 · reserved B");
    expect(html).toContain(">Fit fallen empire zones…</button>");
  });
});

describe("the game setup grid", () => {
  const cell = (label: string, title: string, value: string) =>
    `aria-label="${label}" placeholder="–" title="${title}" value="${value}"`;
  const bound = (label: string, value: string) => cell(label, CLEAR_RANGE_TITLE, value);
  const count = (label: string, value: string) => cell(label, CLEAR_KEY_TITLE, value);

  async function openSetup(): Promise<string> {
    mockedIpc.openAsScenario.mockResolvedValueOnce({
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
    expect(html).toContain("Scenario header · 3");
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
    await openSetup();
    const html = drawnBy(galaxy);
    expect(html).toContain(bound("Wormhole pairs min", ""));
    expect(html).toContain(count("Gateways default", ""));

    const cell = lastDrawn(({ props }) => props.label === "AI empires min", "AI empires min") as {
      onCommit(value: number | null): void;
    };
    cell.onCommit(null);
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetHeaderField",
        key: "num_empires",
        value: null,
      }),
    );
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
    expect(html).toContain("Supported shapes");
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
    mockedIpc.openAsScenario.mockResolvedValueOnce({
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
    mockedIpc.openAsScenario.mockResolvedValueOnce({
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

    drawnBy(galaxy);
    const ring = lastDrawn(
      ({ type, props }) => type === "input" && props["aria-label"] === "ring shape",
      "the ring shape's box",
    ) as { onChange(): void };
    ring.onChange();
    await until(() =>
      expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
        type: "SetHeaderList",
        key: "supports_shape",
        values: ["elliptical"],
      }),
    );
  });
});
