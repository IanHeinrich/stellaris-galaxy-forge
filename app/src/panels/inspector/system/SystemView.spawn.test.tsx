import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnModifier } from "../../../generated/SpawnModifier";
import type { SystemNode } from "../../../generated/SystemNode";
import { detailOf } from "../../../store/fixture";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../test/drawn"));

import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { open, overview, resetStores, sections, SYSTEM } from "../inspectorFixture";
import { DEFAULT_SPAWN_WEIGHT } from "../../spawnPoint";
import { drawnBy, drawnButton, drawnCheckbox } from "../../../test/drawn";
import { shown } from "../../../test/elements";
import { mockedIpc } from "../../../test/ipc";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

/** The system as the projection reports it once its statement carries `spawn_weight`. */
function withWeight(weight: number | null, initializer = "basic_init_01"): void {
  mockedIpc.getSystem.mockImplementation(async (id) => {
    const detail = detailOf(id);
    return { ...detail, system: { ...detail.system, spawn_weight: weight, initializer } };
  });
}

describe("a scenario system's initializer hint for a seat", () => {
  it("shows what an empire landing here brings, and stays quiet for a plain system", async () => {
    withWeight(3);
    await open("scenario");
    expect(overview()).toContain("If no empire lands here, it is used as written.");

    withWeight(null);
    await open("scenario");
    expect(overview()).not.toContain("If no empire lands here, it is used as written.");
  });
});

describe("a scenario system's spawn weight", () => {
  it("offers the toggle unchecked, checked with its weight, and disabled without an initializer", async () => {
    withWeight(null);
    await open("scenario");
    useInspectorStore.setState({ sections: { "system.initializer": false } });
    expect(overview()).toContain("Spawn point");
    expect(overview()).not.toContain('aria-label="Spawn weight"');
    expect(overview()).not.toContain('aria-label="Spawn kind"');

    withWeight(3);
    await open("scenario");
    const on = overview();
    expect(on).toContain("checked=");
    expect(on).toContain('aria-label="Spawn weight"');
    expect(on).toContain('value="3"');

    withWeight(null, "");
    await open("scenario");
    const without = overview();
    expect(without).toContain("disabled=");
    expect(without).toContain("choose one first");
  });

  it("sends the weight the toggle writes, and clears it when it is turned off", async () => {
    withWeight(null);
    await open("scenario");
    drawnBy(overview);
    drawnCheckbox().onChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetSpawnWeight",
      system: SYSTEM,
      base: DEFAULT_SPAWN_WEIGHT,
    });

    withWeight(1);
    await open("scenario");
    drawnBy(overview);
    drawnCheckbox().onChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetSpawnWeight",
      system: SYSTEM,
      base: null,
    });
  });
});

describe("a scenario system's spawn modifiers", () => {
  /** The system as the projection reports its `spawn_weight` block. */
  function withSpawn(extra: Partial<SystemNode>): void {
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return { ...detail, system: { ...detail.system, ...extra } };
    });
  }

  function modifier(extra: Partial<SpawnModifier>): SpawnModifier {
    return { factor: null, add: null, trigger: "", country_flag: null, ...extra };
  }

  it("lists every modifier as the file writes it, chipping the flag one names", async () => {
    withSpawn({
      spawn_weight: 2,
      spawn_design: "player_design",
      spawn_modifiers: [
        modifier({ factor: 0, trigger: "is_ai = yes" }),
        modifier({ add: 5, trigger: "has_country_flag = my_flag", country_flag: "my_flag" }),
        modifier({ factor: 2, trigger: "has_star_flag = empire_cluster" }),
      ],
    });
    await open("scenario");

    const html = overview();
    expect(html).toContain("Modifiers · 3");
    // An author's own trigger is shown as written, with nothing read into it.
    expect(shown(html)).toContain("×0 is_ai = yes");
    expect(html).toContain("+5");
    expect(html).toContain(">flag: my_flag<");
    // Script this editor does not read is still shown, by the trigger it states.
    expect(html).toContain("×2");
    expect(html).toContain("has_star_flag = empire_cluster");
    expect(html).toContain("player_design");
  });

  it("offers only the spawn point checkbox, whoever the modifiers name", async () => {
    withSpawn({
      spawn_weight: 1,
      spawn_modifiers: [modifier({ factor: 0, trigger: "is_ai = yes" })],
    });
    await open("scenario");

    expect(overview().match(/<input type="checkbox"[^>]*>/g)).toHaveLength(1);
  });
});

describe("a scenario system Paint a Galaxy seats", () => {
  /** The system as the projection reads the site's `spawn_weight` idiom. */
  function withScript(
    kind: "enabled" | "preferred" | "sol" | { reserved: string },
    player = false,
  ): void {
    mockedIpc.getSystem.mockImplementation(async (id) => {
      const detail = detailOf(id);
      return {
        ...detail,
        system: {
          ...detail.system,
          spawn_weight: 0,
          spawn_script: { paint_a_galaxy: { kind, random_value: 4, player } },
        },
      };
    });
  }

  it("offers the seat's kind in place of the weight", async () => {
    withScript({ reserved: "c" });
    await open("scenario");
    useInspectorStore.setState({ sections: { "system.initializer": false } });

    const html = overview();
    expect(html).toContain(">Seat<");
    expect(html).toContain('<optgroup label="Reserved for one empire">');
    expect(html).toContain('<option value="reserved:c" selected="">Reserved C</option>');
    expect(html.match(/<option /g)).toHaveLength(53);
    expect(html).not.toContain(">Player<");
    expect(html).toContain("Only an empire whose species has the");
    expect(html).toContain("Reserved Spawn: C");
    expect(html).toContain("trait starts here.");
    expect(html).toContain("The trait comes from the");
    expect(html).toContain("Reserved Spawns submod ↗");
    expect(html.match(/<input type="checkbox"[^>]*>/g)).toHaveLength(2);
    expect(html.match(/<input type="checkbox"[^>]*>/)![0]).toContain("checked=");
    expect(html).not.toContain('aria-label="Spawn weight"');
    expect(html).not.toContain("Reserve for a human player");
    expect(html).not.toContain("Reserve for the AI");
  });

  it("offers the weight below the kind for every seat but an enabled one, and says what it does", async () => {
    withScript("enabled");
    await open("scenario");
    expect(overview()).not.toContain("Weighted for its empire");

    withScript("preferred");
    await open("scenario");
    const preferred = overview();
    expect(preferred).toContain("Weighted for its empire");
    expect(preferred.match(/<input type="checkbox"[^>]*>/g)![1]).not.toContain("checked=");
    expect(preferred).not.toContain("Weighted so");

    withScript("preferred", true);
    await open("scenario");
    const weighted = overview();
    expect(weighted).toContain('<option value="preferred" selected="">1st Player</option>');
    expect(weighted.match(/<input type="checkbox"[^>]*>/g)![1]).toContain("checked=");
    expect(weighted).toContain(
      "Kept for the first player: you in single player, the host in multiplayer.",
    );
    expect(weighted).toContain("Weighted so the first player is all but certain to start here.");

    withScript("sol", true);
    await open("scenario");
    expect(overview()).toContain(
      "Weighted so the United Nations of Earth is certain to start here. No other empire can.",
    );

    withScript({ reserved: "c" }, true);
    await open("scenario");
    expect(overview()).toContain(
      "Weighted so an empire with the &quot;Reserved Spawn: C&quot; trait is certain to start here. No other empire can.",
    );
  });

  it("describes what each kind means, a reserved letter's sentence pointing at the submod", async () => {
    withScript("enabled");
    await open("scenario");
    expect(overview()).toContain("Any empire may start here.");
    expect(overview()).not.toContain("The trait comes from the");

    withScript("preferred");
    await open("scenario");
    expect(overview()).toContain(
      "Kept for the first player: you in single player, the host in multiplayer.",
    );

    withScript("sol");
    await open("scenario");
    const html = overview();
    expect(html).toContain("trait, starts here. Give it Sol&#x27;s initializer.");
    expect(html).toContain("as the parent of a human Lost Colony, such as the Commonwealth");
    expect(html).not.toContain("The trait comes from the");
    expect(html).toContain("For Alpha Centauri and the other neighbours beside it, the");
    expect(html).toContain(">Local Cluster mod</button>");
  });

  it("marks a reserved letter, Sol or the weight as in use only when another system already holds it", async () => {
    withScript({ reserved: "c" });
    await open("scenario");
    const systems = new Map(useGalaxyStore.getState().systems);
    systems.set(2, {
      ...systems.get(2)!,
      spawn_script: { paint_a_galaxy: { kind: { reserved: "c" }, random_value: 1, player: false } },
    });
    systems.set(3, {
      ...systems.get(3)!,
      spawn_script: { paint_a_galaxy: { kind: "sol", random_value: 1, player: false } },
    });
    systems.set(4, {
      ...systems.get(4)!,
      spawn_script: { paint_a_galaxy: { kind: "preferred", random_value: 1, player: true } },
    });
    useGalaxyStore.setState({ systems });

    const html = overview();
    expect(html).toContain('<option value="reserved:c" selected="">Reserved C · in use</option>');
    expect(html).toContain('<option value="sol">Sol · in use</option>');
    expect(html).toContain('<option value="preferred">1st Player</option>');
    expect(html).toContain('<option value="reserved:a">Reserved A</option>');
    expect(html).toContain("Weighted for its empire · in use");
  });

  it("offers a Greek reserved seat by its name, and marks it in use", async () => {
    withScript({ reserved: "alpha" });
    await open("scenario");
    const systems = new Map(useGalaxyStore.getState().systems);
    systems.set(2, {
      ...systems.get(2)!,
      spawn_script: {
        paint_a_galaxy: { kind: { reserved: "omega" }, random_value: 1, player: false },
      },
    });
    useGalaxyStore.setState({ systems });

    const html = overview();
    expect(html).toContain(
      '<option value="reserved:alpha" selected="">Reserved α (Alpha)</option>',
    );
    expect(html).toContain('<option value="reserved:omega">Reserved ω (Omega) · in use</option>');
    expect(html).toContain("Reserved Spawn: Alpha");
  });

  it("offers a seat in place of a plain weight under the Paint a Galaxy layer", async () => {
    withWeight(3);
    await open("scenario");
    useFileSessionStore.setState({ painted: true });

    const html = overview();
    expect(html).toContain("Use a Paint a Galaxy seat");
    expect(html).toContain("The mod fills seats by kind and ignores this weight.");
  });

  it("writes the op that swaps a plain weight for an enabled Paint a Galaxy seat", async () => {
    withWeight(3);
    await open("scenario");
    useFileSessionStore.setState({ painted: true });
    drawnBy(overview);
    drawnButton("Use a Paint a Galaxy seat").onClick();

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "SetSpawnScript",
      system: SYSTEM,
      script: { paint_a_galaxy: { kind: "enabled", random_value: SYSTEM % 10, player: false } },
    });
  });
});

describe("the spawn point section", () => {
  it("leads the initializer it weighs, and is the file's own, not what the key places", async () => {
    await open("scenario");

    const html = overview();
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("basic_init_01"));
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("Change…"));
    expect(html.indexOf("Spawn point")).toBeLessThan(html.indexOf("Hyperlanes"));
    expect(html).toContain(">scenario<");
  });

  it("leaves the initializer section open while nothing of the initializers draws", async () => {
    await open("scenario");
    useMapChromeStore.getState().toggleGroup("initializers");

    expect(sections(overview())).toContain("Initializer");
    expect(overview()).toContain("Change…");
  });
});
