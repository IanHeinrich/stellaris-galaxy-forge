import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../../api/__mocks__/dialog"));
// The star icons and deposit art come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import type { PlanetMoveTargets } from "../../../generated/PlanetMoveTargets";
import { bindStores } from "../../../store/bindStores";
import { editResult, planetPage } from "../../../store/fixture";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { SAVE_CAPABILITIES } from "../../../lib/capabilities";
import { open, resetStores, SYSTEM } from "../inspectorFixture";
import type { TargetsRead } from "../../../store/planetMoveStore";
import { READING_TARGETS, SystemChoice, TARGETS_FAILED } from "./PlanetSystemField";
import { escaped as escapedText } from "../../../test/elements";
import { drawnBy, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { ComboField } from "../../ComboField";
import { useEditorStore } from "../../../store/editorStore";
import { WORLD, EMPIRE, landPage, render } from "./bodyPageFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

describe("the System field", () => {
  const targets = (over: Partial<PlanetMoveTargets> = {}): PlanetMoveTargets => ({
    planets: [WORLD],
    refused: [],
    systems: [
      { system: 3, warnings: [] },
      { system: 0, warnings: [] },
    ],
    ...over,
  });
  const field = (read: TargetsRead | null) =>
    renderToStaticMarkup(<SystemChoice id={WORLD} system={SYSTEM} read={read} />);

  it("is on the page only where the document moves planets", async () => {
    await open("save");
    await landPage(planetPage({ id: WORLD, system: SYSTEM }));
    const moveTitle = `title="${READING_TARGETS}"`;
    expect(render(WORLD)).toContain(moveTitle);

    useFileSessionStore.setState({ capabilities: { ...SAVE_CAPABILITIES, planet_moves: false } });
    expect(render(WORLD)).not.toContain(moveTitle);
  });

  it("shows the planet's system, and waits for where it can move", async () => {
    await open("save");
    expect(field(null)).toContain(`title="${READING_TARGETS}"`);
    const html = field({ targets: targets() });
    expect(html).toContain('value="Alpha Centauri"');
    expect(html).not.toContain("disabled");
  });

  it("keeps the picked system's warning under the field until the next edit", async () => {
    await open("save");
    const warning = { planet: WORLD, kind: "station", owner: 1, new_owner: EMPIRE } as const;
    const read = { targets: targets({ systems: [{ system: 3, warnings: [warning] }] }) };
    mockedIpc.planetMoveOp.mockResolvedValue({ type: "Batch", description: "Moved", ops: [] });
    mockedIpc.applyOp.mockResolvedValue(editResult());
    drawnBy(() => field(read));
    drawnField(ComboField, "System").onPick("3");
    await vi.waitFor(() => expect(field(read)).toContain("station will change ownership to"));

    mockedIpc.applyOp.mockResolvedValue(editResult({ history: { undo: [], redo: [] } }));
    await useEditorStore.getState().applyOp({ type: "MoveSystem", system: 3, x: 1, y: 1 });
    expect(field(read)).not.toContain("station will change ownership to");
  });

  it("says so when the core could not say where the planet can move", async () => {
    await open("save");
    const html = field({ failed: true });
    expect(html).toContain("disabled");
    expect(html).toContain(escapedText(TARGETS_FAILED));
  });

  it("is disabled with the core's refusal for a planet that cannot move", async () => {
    await open("save");
    const reason = "Nekkar I has an arc furnace: planets with a megastructure can't move";
    const html = field({ targets: targets({ refused: [{ planet: WORLD, reason }], systems: [] }) });
    expect(html).toContain("disabled");
    expect(html).toContain(escapedText(reason));
  });
});
