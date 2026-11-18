import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { ModifierChoice } from "../generated/ModifierChoice";
import { modifierPickRows } from "../lib/details/modifierPicker";
import { systemModifierTarget } from "../lib/details/systemModifiers";
import { mockedIpc } from "../test/ipc";
import { systemSpawn } from "../test/spawn";
import { bindStores } from "./bindStores";
import { useDetailsStore } from "./detailsStore";
import { editor, openFixtureScenario } from "./editorFixture";
import { editResult, modifierChoice, systemDetails } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { removeSystemModifier, useSystemModifierPickerStore } from "./systemModifierPickerStore";

bindStores();

const SYS = 2;
const CHOICES: ModifierChoice[] = [modifierChoice("queen_scorn_storm", "Veil of Scorn")];
const ROW = modifierPickRows(CHOICES, [], null, () => "")[0];
const HELD = { modifier: "vluur_storm", days: -1, editable: true };
const TARGET = systemModifierTarget(SYS, "Kel", [HELD]);
const picker = () => useSystemModifierPickerStore.getState();

beforeEach(async () => {
  vi.clearAllMocks();
  await openFixtureScenario();
  picker().reset();
  useGameDataStore.setState({ status: "ready" });
  useDetailsStore.setState({
    details: new Map([
      [SYS, systemDetails({ id: SYS, spawn: systemSpawn({ modifiers: [HELD] }) })],
    ]),
  });
  mockedIpc.getSystemModifierChoices.mockResolvedValue(CHOICES);
  mockedIpc.applyOp.mockResolvedValue(editResult({ details_stale: [SYS] }));
  mockedIpc.undo.mockResolvedValue(editResult({ details_stale: [SYS] }));
});

describe("a scenario system's modifiers", () => {
  it("are offered with what the system's own block holds, which the list keeps once read", async () => {
    picker().open(TARGET);
    expect(await picker().load(TARGET)).toEqual(CHOICES);
    expect(mockedIpc.getSystemModifierChoices).toHaveBeenCalledWith(["vluur_storm"]);

    picker().open(systemModifierTarget(SYS, "Kel", []));
    await picker().load(TARGET);
    expect(mockedIpc.getSystemModifierChoices).toHaveBeenCalledTimes(1);
  });

  it("add one for good with AddSystemModifier, stay open with the search, and say what was added", async () => {
    picker().open(TARGET);
    picker().setQuery("scorn");
    await picker().add(ROW);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "AddSystemModifier",
      system: SYS,
      modifier: "queen_scorn_storm",
    });
    expect([picker().target?.key, picker().query, picker().added]).toEqual([
      `system:${SYS}`,
      "scorn",
      "Added Veil of Scorn",
    ]);
    expect(useDetailsStore.getState().stale.has(SYS), "the page reads the system again").toBe(true);
  });

  it("say nothing was added when the core refuses the add", async () => {
    mockedIpc.applyOp.mockRejectedValue(new Error("Kel already has it"));
    picker().open(TARGET);
    await picker().add(ROW);
    expect(picker().added).toBeNull();
  });

  it("take one out with RemoveSystemModifier", async () => {
    expect(await removeSystemModifier(SYS, "vluur_storm")).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "RemoveSystemModifier",
      system: SYS,
      modifier: "vluur_storm",
    });
  });

  it("go back with undo, which reads the system again", async () => {
    picker().open(TARGET);
    await picker().add(ROW);
    useDetailsStore.setState({ stale: new Set() });
    await editor().undo();
    expect(mockedIpc.undo).toHaveBeenCalledTimes(1);
    expect(useDetailsStore.getState().stale.has(SYS)).toBe(true);

    await removeSystemModifier(SYS, "vluur_storm");
    useDetailsStore.setState({ stale: new Set() });
    await editor().undo();
    expect(mockedIpc.undo).toHaveBeenCalledTimes(2);
    expect(useDetailsStore.getState().stale.has(SYS)).toBe(true);
  });
});
