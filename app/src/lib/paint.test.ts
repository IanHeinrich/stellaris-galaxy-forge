import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpawnScript } from "../generated/SpawnScript";
import { systemNode } from "../test/builders";
import {
  PAINT_MOD_WORKSHOP_ID,
  PAINT_ORIGIN,
  PAINT_READY,
  PAINT_SPAWN_KINDS,
  PAINT_URL,
  enabledScript,
  isPaintMade,
  isPaintModEnabled,
  isPaintReadyMessage,
  paintEmbedUrl,
  paintKindKey,
  parsePaintMessage,
  scriptForKind,
  spawnScriptLabel,
} from "./paint";

const galaxy = { source: "paint-a-galaxy", type: "galaxy", version: 1, name: "Spiral", txt: "x" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paintEmbedUrl", () => {
  it("asks the site for embedded mode and names this app, in the query before any hash", () => {
    const raw = paintEmbedUrl();
    expect(raw).toContain("parentAppName=Stellaris%20Galaxy%20Forge");
    expect(raw).not.toContain("+");
    const url = new URL(raw);
    expect(url.origin).toBe(PAINT_ORIGIN);
    expect(url.origin).toBe(new URL(PAINT_URL).origin);
    expect(url.searchParams.get("embeddedMode")).toBe("true");
    expect(url.searchParams.get("parentAppName")).toBe("Stellaris Galaxy Forge");
    expect(url.hash).toBe("");
  });

  it("takes a local build from VITE_PAINT_URL, and accepts messages from it", async () => {
    vi.stubEnv("VITE_PAINT_URL", "http://localhost:5173/paint/#/editor");
    vi.resetModules();
    const fresh = await import("./paint");
    const raw = fresh.paintEmbedUrl();
    expect(raw).toContain("?embeddedMode=true&parentAppName=Stellaris%20Galaxy%20Forge#/editor");
    const url = new URL(raw);
    expect(url.origin).toBe("http://localhost:5173");
    expect(url.pathname).toBe("/paint/");
    expect(url.searchParams.get("embeddedMode")).toBe("true");
    expect(url.hash).toBe("#/editor");
    expect(fresh.PAINT_ORIGIN).toBe("http://localhost:5173");
    expect(fresh.PAINT_URL).toBe(PAINT_URL);
  });
});

describe("parsePaintMessage", () => {
  it("takes a galaxy message with its name and text", () => {
    expect(parsePaintMessage(galaxy)).toEqual({ name: "Spiral", txt: "x" });
  });

  it("names a galaxy the site left unnamed", () => {
    expect(parsePaintMessage({ ...galaxy, name: undefined })).toEqual({
      name: "Painted galaxy",
      txt: "x",
    });
    expect(parsePaintMessage({ ...galaxy, name: 3 })?.name).toBe("Painted galaxy");
    expect(parsePaintMessage({ ...galaxy, name: "  " })?.name).toBe("Painted galaxy");
  });

  it("refuses anything that is not a galaxy from the site", () => {
    expect(parsePaintMessage(null)).toBeNull();
    expect(parsePaintMessage("galaxy")).toBeNull();
    expect(parsePaintMessage({ ...galaxy, source: "someone-else" })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, type: "ready" })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, txt: "" })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, txt: undefined })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, txt: ["x"] })).toBeNull();
  });
});

describe("the ready handshake", () => {
  it("recognises the site's ready message and nothing else", () => {
    expect(isPaintReadyMessage({ source: "paint-a-galaxy", type: "ready", version: 1 })).toBe(true);
    expect(isPaintReadyMessage(galaxy)).toBe(false);
    expect(isPaintReadyMessage({ source: "x", type: "ready" })).toBe(false);
    expect(isPaintReadyMessage(null)).toBe(false);
  });

  it("answers under this app's own name", () => {
    expect(PAINT_READY).toEqual({ source: "stellaris-galaxy-forge", type: "ready", version: 1 });
  });
});

/** A system seated by the site's script. */
function scripted(id: number, kind: SpawnScript["paint_a_galaxy"]["kind"], random_value = 3) {
  return systemNode({ id, spawn_script: { paint_a_galaxy: { kind, random_value } } });
}

describe("a painted galaxy", () => {
  it("is one where any system spawns through the site's script", () => {
    expect(isPaintMade([systemNode({ id: 0 }), scripted(1, "enabled")])).toBe(true);
    expect(isPaintMade([systemNode({ id: 0 }), systemNode({ id: 1, spawn_weight: 2 })])).toBe(
      false,
    );
    expect(isPaintMade([])).toBe(false);
  });

  it("names each seat, a reserved letter in capitals", () => {
    expect(spawnScriptLabel(scripted(1, "enabled").spawn_script!)).toBe("enabled");
    expect(spawnScriptLabel(scripted(1, "preferred").spawn_script!)).toBe("preferred");
    expect(spawnScriptLabel(scripted(1, { reserved: "a" }).spawn_script!)).toBe("reserved A");
    expect(spawnScriptLabel(scripted(1, "sol").spawn_script!)).toBe("Sol");
  });

  it("offers every seat once, keyed so a select can round-trip the kind", () => {
    expect(PAINT_SPAWN_KINDS).toHaveLength(29);
    expect(PAINT_SPAWN_KINDS[0]).toEqual({ key: "enabled", label: "enabled" });
    expect(PAINT_SPAWN_KINDS[2]).toEqual({ key: "reserved:a", label: "reserved A" });
    expect(PAINT_SPAWN_KINDS[27]).toEqual({ key: "reserved:z", label: "reserved Z" });
    expect(PAINT_SPAWN_KINDS[28]).toEqual({ key: "sol", label: "Sol" });
    expect(paintKindKey("preferred")).toBe("preferred");
    expect(paintKindKey({ reserved: "B" })).toBe("reserved:b");
    for (const { key } of PAINT_SPAWN_KINDS) {
      expect(paintKindKey(scriptForKind(key, systemNode()).paint_a_galaxy.kind)).toBe(key);
    }
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

describe("the companion mod", () => {
  const mod = (id: string, name: string, status = "loaded") => ({ id, name, dir: null, status });

  it("is enabled when the playset lists the Workshop copy or a local copy by name", () => {
    expect(PAINT_MOD_WORKSHOP_ID).toBe("3532904115");
    expect(isPaintModEnabled([mod("ugc_1", "UI Overhaul"), mod("ugc_3532904115", "PaG")])).toBe(
      true,
    );
    expect(isPaintModEnabled([mod("local_7", "Paint a Galaxy")])).toBe(true);
    expect(isPaintModEnabled([mod("local_7", "My paint A GALAXY fork")])).toBe(true);
    expect(isPaintModEnabled([mod("ugc_3532904115", "PaG", "missing")])).toBe(true);
  });

  it("is not enabled when the playset lists neither", () => {
    expect(isPaintModEnabled([])).toBe(false);
    expect(isPaintModEnabled([mod("ugc_1", "UI Overhaul"), mod("ugc_35329041150", "Galaxy")])).toBe(
      false,
    );
  });
});
