import { describe, expect, it } from "vitest";
import type { SpawnScript } from "../generated/SpawnScript";
import { systemNode } from "../test/builders";
import {
  PAINT_MOD_WORKSHOP_ID,
  PAINT_SPAWN_KINDS,
  PAINT_WORKSHOP_URL,
  RESERVED_SPAWNS_WORKSHOP_URL,
  enabledScript,
  paintKindDescription,
  paintKindKey,
  paintLayer,
  scriptForKind,
  spawnScriptLabel,
} from "./paint";

/** A system seated by the site's script. */
function scripted(id: number, kind: SpawnScript["paint_a_galaxy"]["kind"], random_value = 3) {
  return systemNode({ id, spawn_script: { paint_a_galaxy: { kind, random_value } } });
}

describe("a painted galaxy", () => {
  it("names each seat, a reserved letter in capitals", () => {
    expect(spawnScriptLabel(scripted(1, "enabled").spawn_script!)).toBe("enabled");
    expect(spawnScriptLabel(scripted(1, "preferred").spawn_script!)).toBe("preferred");
    expect(spawnScriptLabel(scripted(1, { reserved: "a" }).spawn_script!)).toBe("reserved A");
    expect(spawnScriptLabel(scripted(1, "sol").spawn_script!)).toBe("Sol");
  });

  it("offers every seat once, keyed so a select can round-trip the kind", () => {
    expect(PAINT_SPAWN_KINDS).toHaveLength(29);
    expect(PAINT_SPAWN_KINDS[0]).toEqual({ key: "enabled", label: "Enabled" });
    expect(PAINT_SPAWN_KINDS[1]).toEqual({ key: "preferred", label: "Preferred" });
    expect(PAINT_SPAWN_KINDS[2]).toEqual({ key: "sol", label: "Sol" });
    expect(PAINT_SPAWN_KINDS[3]).toEqual({ key: "reserved:a", label: "Reserved A" });
    expect(PAINT_SPAWN_KINDS[28]).toEqual({ key: "reserved:z", label: "Reserved Z" });
    expect(paintKindKey("preferred")).toBe("preferred");
    expect(paintKindKey({ reserved: "B" })).toBe("reserved:b");
    for (const { key } of PAINT_SPAWN_KINDS) {
      expect(paintKindKey(scriptForKind(key, systemNode()).paint_a_galaxy.kind)).toBe(key);
    }
  });

  it("describes what each kind means, a reserved letter's sentence ending before its submod", () => {
    expect(paintKindDescription("enabled")).toBe("Any empire may start here.");
    expect(paintKindDescription("preferred")).toContain("Filled before enabled seats.");
    expect(paintKindDescription("sol")).toContain("United Nations of Earth counts as holding it.");
    expect(paintKindDescription({ reserved: "c" })).toBe(
      'Only an empire whose species has the "Reserved Spawn C" trait starts here.',
    );
    expect(paintKindDescription({ reserved: "c" })).not.toContain("The trait comes from");
  });

  it("links the Reserved Spawns submod by its id", () => {
    expect(RESERVED_SPAWNS_WORKSHOP_URL).toBe(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3762808682",
    );
  });

  it("keeps a system's random value across a change of seat, and spreads a new one by id", () => {
    expect(scriptForKind("reserved:c", scripted(7, "enabled", 4))).toEqual({
      paint_a_galaxy: { kind: { reserved: "c" }, random_value: 4 },
    });
    expect(scriptForKind("preferred", systemNode({ id: 23 }))).toEqual({
      paint_a_galaxy: { kind: "preferred", random_value: 3 },
    });
    expect(enabledScript(systemNode({ id: 10 }))).toEqual({
      paint_a_galaxy: { kind: "enabled", random_value: 0 },
    });
    expect(() => scriptForKind("nowhere", systemNode())).toThrow();
  });
});

describe("the Paint a Galaxy layer", () => {
  const DIR = "C:\\mods\\pag\\map\\setup_scenarios";
  const mod = (scenarios_dir: string | null, enabled = true) => ({ scenarios_dir, enabled });
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
