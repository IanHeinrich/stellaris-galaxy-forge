import { describe, expect, it } from "vitest";
import type { LeftOut } from "../generated/LeftOut";
import type { PickSummary } from "../generated/PickSummary";
import type { SystemNode } from "../generated/SystemNode";
import { systemNode } from "../test/builders";
import { addedAmong, deleteAddedLabel, pickCard } from "./addSystem";

describe("the Delete added systems entry", () => {
  const systems = new Map<number, SystemNode>(
    [0, 3, 6, 7, 8].map((id) => [id, systemNode({ id, x: id, added: id > 5 })]),
  );

  it("counts the added systems and the file's own it skips", () => {
    const label = (ids: number[]) => {
      const among = addedAmong(systems, ids);
      return deleteAddedLabel(among.length, ids.length - among.length);
    };
    expect(label([6, 8])).toBe("Delete 2 added systems");
    expect(label([0, 6, 3, 8, 7])).toBe("Delete 3 added systems (skips 2 already in the save)");
    expect(label([7, 0])).toBe("Delete 1 added system (skips 1 already in the save)");
    expect(label([0, 3])).toBeNull();
  });
});

describe("a special layout's card", () => {
  const summary = (extra: Partial<PickSummary> = {}): PickSummary => ({
    star_classes: [{ key: "sc_m", name: "Class M Star" }],
    star_description: null,
    planets: { min: 2, max: 5 },
    max_moons: 0,
    moons: "never",
    belts: { min: 0, max: 0 },
    belt_kinds: [],
    asteroids: { min: 0, max: 0 },
    named_bodies: [],
    notable_classes: [],
    modifiers: [],
    rings: "never",
    dlc: null,
    max_instances: null,
    in_galaxy: null,
    ...extra,
  });
  const line = (card: ReturnType<typeof pickCard>, label: string) =>
    card.lines.find((l) => l.label === label)?.text;

  it("names what it comes with, and says nothing when it comes with nothing", () => {
    const card = pickCard(
      summary({
        comes_with: [
          { kind: "anomaly", key: "BREACHSEALER_CAT", name: "Breachsealer" },
          { kind: "dig_site", key: "site_graveyard", name: "Tiyanki Graveyard" },
        ],
      }),
      "Seddom",
    );
    expect(line(card, "Comes with")).toBe("Breachsealer, Tiyanki Graveyard");
    const bare = pickCard(summary(), "Seddom");
    expect(bare.lines.map((l) => l.label)).toEqual(["Star", "Planets"]);
  });

  it("names every kind it comes without in plain words, in the order given", () => {
    const every: LeftOut[] = [
      "pre_ftl_civilisation",
      "colony",
      "empire",
      "fleets",
      "starbase",
      "anomaly",
      "dig_site",
      "spawned_planets",
      "ambient_objects",
    ];
    expect(line(pickCard(summary({ comes_without: every }), "Seddom"), "Comes without")).toBe(
      "a pre-FTL civilisation, colonies and pops, its empire, fleets and guardians, a starbase, an anomaly, a dig site, some of its planets, debris, wrecks and storms",
    );
    expect(line(pickCard(summary({ comes_without: ["fleets"] }), "Seddom"), "Comes without")).toBe(
      "fleets and guardians",
    );
  });

  it("warns that the galaxy's own copy keeps the event chain, naming the layout", () => {
    expect(pickCard(summary({ story_kept_by_existing: true }), "Tiyun Ort").storyKept).toBe(
      "Tiyun Ort is already in this galaxy, so its event chain stays with that one.",
    );
    expect(pickCard(summary(), "Tiyun Ort").storyKept).toBeNull();
  });
});
