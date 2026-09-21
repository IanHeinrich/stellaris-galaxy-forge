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
import { addHeaderField, DUPLICATE_KEY_TITLE, removeHeaderField, setHeaderField } from "./header";

const mocked = {
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
  applyOp: vi.mocked(ipc.applyOp),
  onProgress: vi.mocked(onProgress),
};

/** A header as a scenario writes one: a name, and a key the file states twice. */
const HEADER: HeaderField[] = [
  { key: "name", value: '"My Galaxy"', line: 2 },
  { key: "supports_shape", value: "elliptical", line: 5 },
  { key: "supports_shape", value: "ring", line: 6 },
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
  it("counts the drawn ones and says how many the game scatters itself", async () => {
    await open("scenario");
    useGameDataStore.setState({ scenarioBypasses: SCENARIO_BYPASSES });

    const html = galaxy();
    expect(html).toContain(">Bypasses</span><span>3</span>");
    expect(html).toContain("3 wormhole pairs and 1 gateway placed at random on day one");
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
    expect(count(html, 'aria-label="supports_shape value"')).toBe(1);
    expect(count(html, 'aria-label="Remove supports_shape"')).toBe(1);
    expect(html).toContain('value="elliptical"');
    expect(html).toContain(`title="${DUPLICATE_KEY_TITLE}"`);
    expect(html).toContain(">ring<");
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

    await useEditorStore.getState().applyOp(removeHeaderField("supports_shape"));
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "SetHeaderField",
      key: "supports_shape",
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
