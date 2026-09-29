import { describe, expect, it } from "vitest";
import type { HeaderField } from "../generated/HeaderField";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { SpawnScript } from "../generated/SpawnScript";
import { paintModView, scenarioSummary, systemNode } from "../test/builders";
import { RESERVED_SEAT_NAMES } from "../generated/constants";
import {
  PAINT_SPAWN_KINDS,
  RESERVED_SPAWN_KINDS,
  SEAT_KINDS,
  canBeWeighted,
  enabledScript,
  paintKindDescription,
  paintKindKey,
  paintLayer,
  reservedName,
  reservedSeatName,
  scenarioForPaint,
  scenarioHeaderName,
  scenarioOpenPrompt,
  scriptForKind,
  seatSummary,
  spawnScriptLabel,
  weightedDescription,
  weightedScript,
} from "./paint";

/** A system seated by the site's script. */
function scripted(
  id: number,
  kind: SpawnScript["paint_a_galaxy"]["kind"],
  random_value = 3,
  player = false,
) {
  return systemNode({ id, spawn_script: { paint_a_galaxy: { kind, random_value, player } } });
}

/** The site's script alone, as the helpers that read one take it. */
function script(kind: SpawnScript["paint_a_galaxy"]["kind"], player = false): SpawnScript {
  return scripted(1, kind, 3, player).spawn_script!;
}

describe("a painted galaxy", () => {
  it("names each seat, a reserved name capitalised and a weighted one by its weight", () => {
    expect(spawnScriptLabel(script("enabled"))).toBe("enabled");
    expect(spawnScriptLabel(script("preferred"))).toBe("1st Player");
    expect(spawnScriptLabel(script("preferred", true))).toBe("1st Player, weighted");
    expect(spawnScriptLabel(script({ reserved: "a" }))).toBe("reserved A");
    expect(spawnScriptLabel(script({ reserved: "a" }, true))).toBe("reserved A, weighted");
    expect(spawnScriptLabel(script({ reserved: "alpha" }))).toBe("reserved Alpha");
    expect(spawnScriptLabel(script("sol"))).toBe("Sol");
    expect(spawnScriptLabel(script("sol", true))).toBe("Sol, weighted");
  });

  it("shows a Latin reserved seat by its letter and a Greek one by its name, chipped with its symbol", () => {
    expect(reservedName("a")).toEqual({ display: "A", tag: "A" });
    expect(reservedName("alpha")).toEqual({ display: "Alpha", tag: "α" });
    expect(reservedName("OMEGA")).toEqual({ display: "Omega", tag: "ω" });
    expect(reservedName("sigma")).toEqual({ display: "Sigma", tag: "σ" });
    expect(SEAT_KINDS.reserved.tag(reservedName("lambda"))).toBe("λ");
    for (const name of RESERVED_SEAT_NAMES) expect([...reservedName(name).tag]).toHaveLength(1);
  });

  it("offers every seat once, keyed so a select can round-trip the kind", () => {
    expect(PAINT_SPAWN_KINDS).toHaveLength(53);
    expect(PAINT_SPAWN_KINDS[0]).toEqual({ key: "enabled", label: "Enabled" });
    expect(PAINT_SPAWN_KINDS[1]).toEqual({ key: "preferred", label: "1st Player" });
    expect(PAINT_SPAWN_KINDS[2]).toEqual({ key: "sol", label: "Sol" });
    expect(PAINT_SPAWN_KINDS[3]).toEqual({ key: "reserved:a", label: "Reserved A" });
    expect(PAINT_SPAWN_KINDS[28]).toEqual({ key: "reserved:z", label: "Reserved Z" });
    expect(PAINT_SPAWN_KINDS[29]).toEqual({ key: "reserved:alpha", label: "Reserved Alpha" });
    expect(PAINT_SPAWN_KINDS[52]).toEqual({ key: "reserved:omega", label: "Reserved Omega" });
    expect(RESERVED_SPAWN_KINDS.map((k) => k.key)).toEqual(
      RESERVED_SEAT_NAMES.map((name) => `reserved:${name}`),
    );
    expect(paintKindKey(script("preferred"))).toBe("preferred");
    expect(paintKindKey(script("preferred", true))).toBe("preferred");
    expect(paintKindKey(script({ reserved: "B" }))).toBe("reserved:b");
    expect(paintKindKey(script({ reserved: "Alpha" }))).toBe("reserved:alpha");
    expect(scriptForKind("reserved:alpha", systemNode()).paint_a_galaxy.kind).toEqual({
      reserved: "alpha",
    });
    expect(reservedSeatName("reserved:alpha")).toBe("Alpha");
    expect(reservedSeatName("reserved:c")).toBe("C");
    for (const { key } of PAINT_SPAWN_KINDS) {
      expect(paintKindKey(scriptForKind(key, systemNode()))).toBe(key);
    }
  });

  it("describes what each kind means, a reserved seat's sentence ending before its submod", () => {
    expect(paintKindDescription(script("enabled"))).toBe("Any empire may start here.");
    expect(paintKindDescription(script("preferred"))).toBe(
      "Kept for the first player: you in single player, the host in multiplayer. AI empires and " +
        "other players seldom start here. Use reserved seats to choose where they start.",
    );
    expect(paintKindDescription(script("preferred", true))).toBe(
      paintKindDescription(script("preferred")),
    );
    expect(paintKindDescription(script("sol"))).toBe(
      'Only the United Nations of Earth, or an empire with the "Reserved Spawn Sol" trait, starts ' +
        "here. Give it Sol's initializer. When no one plays the United Nations of Earth, Paint a " +
        "Galaxy puts it on this Sol as the parent of a human Lost Colony, such as the Commonwealth " +
        "of Man.",
    );
    expect(paintKindDescription(script({ reserved: "c" }))).toBe(
      'Only an empire whose species has the "Reserved Spawn: C" trait starts here.',
    );
    expect(paintKindDescription(script({ reserved: "alpha" }))).toBe(
      'Only an empire whose species has the "Reserved Spawn: Alpha" trait starts here.',
    );
    expect(paintKindDescription(script({ reserved: "c" }))).not.toContain("The trait comes from");
  });

  it("keeps a system's random value across a change of seat, and spreads a new one by id", () => {
    expect(scriptForKind("reserved:c", scripted(7, "enabled", 4))).toEqual({
      paint_a_galaxy: { kind: { reserved: "c" }, random_value: 4, player: false },
    });
    expect(scriptForKind("preferred", systemNode({ id: 23 }))).toEqual({
      paint_a_galaxy: { kind: "preferred", random_value: 3, player: false },
    });
    expect(enabledScript(systemNode({ id: 10 }))).toEqual({
      paint_a_galaxy: { kind: "enabled", random_value: 0, player: false },
    });
    expect(() => scriptForKind("nowhere", systemNode())).toThrow();
  });

  it("keeps the weight across a change to a kind that can carry it, and drops it for enabled", () => {
    expect(scriptForKind("sol", scripted(7, "preferred", 4, true))).toEqual({
      paint_a_galaxy: { kind: "sol", random_value: 4, player: true },
    });
    expect(scriptForKind("reserved:b", scripted(7, "sol", 4, true))).toEqual({
      paint_a_galaxy: { kind: { reserved: "b" }, random_value: 4, player: true },
    });
    expect(scriptForKind("enabled", scripted(7, "preferred", 4, true))).toEqual({
      paint_a_galaxy: { kind: "enabled", random_value: 4, player: false },
    });
    expect(scriptForKind("preferred", scripted(7, "enabled", 4))).toEqual({
      paint_a_galaxy: { kind: "preferred", random_value: 4, player: false },
    });
    expect(canBeWeighted("enabled")).toBe(false);
    for (const kind of ["preferred", "sol", { reserved: "a" }] as const) {
      expect(canBeWeighted(kind)).toBe(true);
    }
  });

  it("turns the weight on or off, keeping the seat's kind and random value", () => {
    expect(weightedScript(scripted(7, "sol", 4), true)).toEqual({
      paint_a_galaxy: { kind: "sol", random_value: 4, player: true },
    });
    expect(weightedScript(scripted(7, { reserved: "c" }, 4, true), false)).toEqual({
      paint_a_galaxy: { kind: { reserved: "c" }, random_value: 4, player: false },
    });
  });

  it("says what the weight does for each kind that can carry it", () => {
    expect(weightedDescription("preferred")).toBe(
      "Weighted so the first player is all but certain to start here.",
    );
    expect(weightedDescription("sol")).toBe(
      "Weighted so the United Nations of Earth is certain to start here. No other empire can.",
    );
    expect(weightedDescription({ reserved: "c" })).toBe(
      'Weighted so an empire with the "Reserved Spawn: C" trait is certain to start here. No other empire can.',
    );
  });
});

describe("the Paint a Galaxy layer", () => {
  const DIR = "C:\\mods\\pag\\map\\setup_scenarios";
  const mod = (scenarios_dir: string | null) => paintModView({ scenarios_dir });
  const doc = (over: Partial<Parameters<typeof paintLayer>[0]> = {}) => ({
    kind: "scenario" as const,
    path: null,
    painted: false,
    paintChosen: false,
    ...over,
  });

  it("is on for a painted scenario, or one the user chose as such, whatever the mod says", () => {
    expect(paintLayer(doc({ painted: true }), null)).toBe(true);
    expect(paintLayer(doc({ paintChosen: true }), null)).toBe(true);
    expect(paintLayer(doc(), null)).toBe(false);
    expect(paintLayer(doc(), mod(DIR))).toBe(false);
  });

  it("is on for a plain scenario saved inside the mod's scenarios folder", () => {
    expect(paintLayer(doc({ path: `${DIR}\\mine.txt` }), mod(DIR))).toBe(true);
    expect(paintLayer(doc({ path: "c:/mods/pag/map/setup_scenarios/mine.txt" }), mod(DIR))).toBe(
      true,
    );
    expect(
      paintLayer(doc({ path: "C:\\mods\\mine\\map\\setup_scenarios\\mine.txt" }), mod(DIR)),
    ).toBe(false);
    expect(paintLayer(doc({ path: `${DIR}\\mine.txt` }), mod(null))).toBe(false);
    expect(paintLayer(doc({ path: `${DIR}\\mine.txt` }), null)).toBe(false);
  });

  it("is never on for a save, or before a document is open", () => {
    expect(paintLayer(doc({ kind: "save", painted: true, paintChosen: true }), mod(DIR))).toBe(
      false,
    );
    expect(paintLayer(doc({ kind: null, paintChosen: true }), mod(DIR))).toBe(false);
  });
});

describe("opening a scenario file", () => {
  const DIR = "C:\\mods\\pag\\map\\setup_scenarios";
  const MOD = paintModView({ scenarios_dir: DIR, enabled: true });
  const OFF = paintModView({ scenarios_dir: DIR, enabled: false });
  const listing = (path: string, painted: boolean): ScenarioListing => ({
    path,
    name: "a_galaxy",
    systems: 100,
    source: "mod",
    mod_name: "A Mod",
    enabled: true,
    shadowed_by: null,
    modified: 10,
    size: 1024,
    error: null,
    summary: scenarioSummary(),
    painted,
  });
  const PAINTED = "C:/mods/a/map/setup_scenarios/painted.txt";
  const PLAIN = "C:/mods/a/map/setup_scenarios/plain.txt";
  const LISTED = [listing(PAINTED, true), listing(PLAIN, false)];

  it("is for the mod when its listing says it is painted, or it sits in the mod's folder", () => {
    expect(scenarioForPaint(PAINTED, LISTED, null)).toBe(true);
    expect(scenarioForPaint("c:\\mods\\a\\map\\setup_scenarios\\painted.txt", LISTED, null)).toBe(
      true,
    );
    expect(scenarioForPaint(PLAIN, LISTED, MOD)).toBe(false);
    expect(scenarioForPaint(`${DIR}\\mine.txt`, null, MOD)).toBe(true);
    expect(scenarioForPaint(`${DIR}\\mine.txt`, [listing(`${DIR}\\mine.txt`, false)], MOD)).toBe(
      true,
    );
  });

  it("cannot say for a file that is not listed and not in the mod's folder", () => {
    expect(scenarioForPaint("C:/elsewhere/mine.txt", LISTED, MOD)).toBeNull();
    expect(scenarioForPaint(`${DIR}\\mine.txt`, null, null)).toBeNull();
  });

  it("opens a scenario for the mod at once only while the mod is enabled", () => {
    expect(scenarioOpenPrompt(true, MOD, true)).toBe("none");
    expect(scenarioOpenPrompt(true, OFF, true)).toBe("paint_mod_off");
    expect(scenarioOpenPrompt(true, null, true)).toBe("paint_mod_off");
    expect(scenarioOpenPrompt(true, OFF, false)).toBe("paint_mod_off");
  });

  it("asks first about any other scenario until that warning is turned off", () => {
    expect(scenarioOpenPrompt(false, MOD, true)).toBe("not_for_paint");
    expect(scenarioOpenPrompt(null, MOD, true)).toBe("not_for_paint");
    expect(scenarioOpenPrompt(false, MOD, false)).toBe("none");
    expect(scenarioOpenPrompt(null, null, false)).toBe("none");
  });
});

describe("the scenario header's name", () => {
  it("unquotes the header's name key", () => {
    const header: HeaderField[] = [{ key: "name", value: '"My Galaxy"', line: 2 }];
    expect(scenarioHeaderName(header)).toBe("My Galaxy");
  });

  it("is null when the header states no name", () => {
    expect(scenarioHeaderName([])).toBeNull();
  });
});

describe("the seats a galaxy's scripts add up to", () => {
  it("counts every scripted system and every kind it names, reserved names in the site's order", () => {
    const systems = [
      scripted(1, "enabled"),
      scripted(2, "preferred"),
      scripted(3, "preferred"),
      scripted(4, { reserved: "c" }),
      scripted(5, { reserved: "beta" }),
      scripted(6, { reserved: "a" }),
      scripted(7, "sol", 3, true),
      scripted(8, "enabled"),
      systemNode({ id: 9 }),
    ];
    expect(seatSummary(systems)).toEqual({
      seats: 8,
      preferred: 2,
      reserved: ["A", "C", "Beta"],
      sol: true,
      player: true,
      safeAi: 2,
    });
  });

  it("sets the 1st Player seats aside, and the player's own seat only when there is none", () => {
    const safeAi = (firstPlayer: boolean, playerOn: "sol" | "reserved" | "enabled" | null) =>
      seatSummary([
        scripted(1, "enabled", 0, playerOn === "enabled"),
        scripted(2, "enabled"),
        scripted(3, "enabled"),
        ...(firstPlayer ? [scripted(4, "preferred")] : []),
        scripted(5, { reserved: "a" }, 0, playerOn === "reserved"),
        scripted(6, "sol", 0, playerOn === "sol"),
      ]).safeAi;
    expect(safeAi(true, null)).toBe(3);
    expect(safeAi(true, "enabled")).toBe(3);
    expect(safeAi(true, "reserved")).toBe(3);
    expect(safeAi(false, null)).toBe(2);
    expect(safeAi(false, "enabled")).toBe(2);
    expect(safeAi(false, "reserved")).toBe(3);
    expect(safeAi(false, "sol")).toBe(3);
  });

  it("sets aside every seat a name reserves, though it lists the name once", () => {
    const summary = seatSummary([
      scripted(1, "enabled"),
      scripted(2, "enabled"),
      scripted(3, { reserved: "alpha" }),
      scripted(4, { reserved: "alpha" }),
    ]);
    expect(summary.reserved).toEqual(["Alpha"]);
    expect(summary.safeAi).toBe(1);
  });

  it("leaves out what a plain galaxy never scripts, and floors safe AI empires at zero", () => {
    expect(seatSummary([systemNode({ id: 1 }), systemNode({ id: 2 })])).toEqual({
      seats: 0,
      preferred: 0,
      reserved: [],
      sol: false,
      player: false,
      safeAi: 0,
    });
    expect(seatSummary([scripted(1, { reserved: "b" })])).toEqual({
      seats: 1,
      preferred: 0,
      reserved: ["B"],
      sol: false,
      player: false,
      safeAi: 0,
    });
  });
});
