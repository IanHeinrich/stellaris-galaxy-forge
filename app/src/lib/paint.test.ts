import { describe, expect, it } from "vitest";
import type { HeaderField } from "../generated/HeaderField";
import type { SpawnScript } from "../generated/SpawnScript";
import { systemNode } from "../test/builders";
import {
  LOCAL_CLUSTER_WORKSHOP_URL,
  PAINT_MOD_WORKSHOP_ID,
  PAINT_SPAWN_KINDS,
  PAINT_WORKSHOP_URL,
  RESERVED_SPAWNS_WORKSHOP_URL,
  canBeWeighted,
  enabledScript,
  paintKindDescription,
  paintKindKey,
  paintLayer,
  scenarioHeaderName,
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
  it("names each seat, a reserved letter in capitals and a weighted one by its weight", () => {
    expect(spawnScriptLabel(script("enabled"))).toBe("enabled");
    expect(spawnScriptLabel(script("preferred"))).toBe("preferred");
    expect(spawnScriptLabel(script("preferred", true))).toBe("preferred, weighted");
    expect(spawnScriptLabel(script({ reserved: "a" }))).toBe("reserved A");
    expect(spawnScriptLabel(script({ reserved: "a" }, true))).toBe("reserved A, weighted");
    expect(spawnScriptLabel(script("sol"))).toBe("Sol");
    expect(spawnScriptLabel(script("sol", true))).toBe("Sol, weighted");
  });

  it("offers every seat once, keyed so a select can round-trip the kind", () => {
    expect(PAINT_SPAWN_KINDS).toHaveLength(29);
    expect(PAINT_SPAWN_KINDS[0]).toEqual({ key: "enabled", label: "Enabled" });
    expect(PAINT_SPAWN_KINDS[1]).toEqual({ key: "preferred", label: "Preferred" });
    expect(PAINT_SPAWN_KINDS[2]).toEqual({ key: "sol", label: "Sol" });
    expect(PAINT_SPAWN_KINDS[3]).toEqual({ key: "reserved:a", label: "Reserved A" });
    expect(PAINT_SPAWN_KINDS[28]).toEqual({ key: "reserved:z", label: "Reserved Z" });
    expect(paintKindKey(script("preferred"))).toBe("preferred");
    expect(paintKindKey(script("preferred", true))).toBe("preferred");
    expect(paintKindKey(script({ reserved: "B" }))).toBe("reserved:b");
    for (const { key } of PAINT_SPAWN_KINDS) {
      expect(paintKindKey(scriptForKind(key, systemNode()))).toBe(key);
    }
  });

  it("describes what each kind means, a reserved letter's sentence ending before its submod", () => {
    expect(paintKindDescription(script("enabled"))).toBe("Any empire may start here.");
    expect(paintKindDescription(script("preferred"))).toContain("Filled before enabled seats.");
    expect(paintKindDescription(script("preferred", true))).toBe(
      paintKindDescription(script("preferred")),
    );
    expect(paintKindDescription(script("sol"))).toBe(
      'Only the United Nations of Earth, or an empire with the "Reserved Spawn Sol" trait, starts ' +
        "here. Give it a generic initializer. The United Nations of Earth brings Sol with it, and " +
        "the game will not seat it on a seat that already names Sol's initializer.",
    );
    expect(paintKindDescription(script({ reserved: "c" }))).toBe(
      'Only an empire whose species has the "Reserved Spawn C" trait starts here.',
    );
    expect(paintKindDescription(script({ reserved: "c" }))).not.toContain("The trait comes from");
  });

  it("links the Reserved Spawns submod by its id", () => {
    expect(RESERVED_SPAWNS_WORKSHOP_URL).toBe(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3762808682",
    );
  });

  it("links the Local Cluster submod by its id", () => {
    expect(LOCAL_CLUSTER_WORKSHOP_URL).toBe(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3634498401",
    );
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
      "Weighted so it is the likeliest start once the earlier-placed empires have taken theirs. " +
        "Not a certain one.",
    );
    expect(weightedDescription("sol")).toBe(
      "Weighted so the United Nations of Earth is certain to start here. No other empire can.",
    );
    expect(weightedDescription({ reserved: "c" })).toBe(
      "Weighted so an empire with the Reserved Spawn C trait is certain to start here. No other empire can.",
    );
  });
});

describe("the Paint a Galaxy layer", () => {
  const DIR = "C:\\mods\\pag\\map\\setup_scenarios";
  const mod = (scenarios_dir: string | null, enabled = true) => ({
    scenarios_dir,
    enabled,
    reserved_spawns: true,
  });
  const doc = (over: Partial<Parameters<typeof paintLayer>[0]> = {}) => ({
    kind: "scenario" as const,
    path: null,
    painted: false,
    paintChosen: false,
    ...over,
  });

  it("links the mod's Workshop page by its id", () => {
    expect(PAINT_MOD_WORKSHOP_ID).toBe("3532904115");
    expect(PAINT_WORKSHOP_URL).toBe(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115",
    );
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
  it("counts every scripted system and every kind it names", () => {
    const systems = [
      scripted(1, "enabled"),
      scripted(2, "preferred"),
      scripted(3, "preferred"),
      scripted(4, { reserved: "c" }),
      scripted(5, { reserved: "a" }),
      scripted(6, "sol", 3, true),
      systemNode({ id: 7 }),
    ];
    expect(seatSummary(systems)).toEqual({
      seats: 6,
      preferred: 2,
      reserved: ["A", "C"],
      sol: true,
      player: true,
      safeAi: 2,
    });
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
