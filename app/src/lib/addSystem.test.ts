import { describe, expect, it } from "vitest";
import type { LeftOut } from "../generated/LeftOut";
import type { SystemNode } from "../generated/SystemNode";
import { pickSummary, systemNode } from "../test/builders";
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
  const line = (card: ReturnType<typeof pickCard>, label: string) =>
    card.lines.find((l) => l.label === label)?.text;

  it("names what it comes with, and says nothing when it comes with nothing", () => {
    const card = pickCard(
      pickSummary({
        comes_with: [
          { kind: "anomaly", key: "BREACHSEALER_CAT", name: "Breachsealer" },
          { kind: "dig_site", key: "site_graveyard", name: "Tiyanki Graveyard" },
        ],
      }),
      "Seddom",
    );
    expect(line(card, "Comes with")).toBe("Breachsealer, Tiyanki Graveyard");
    const bare = pickCard(pickSummary(), "Seddom");
    expect(bare.lines.map((l) => l.label)).toEqual(["Star", "Planets"]);
  });

  it("lists what it plants under Comes without when its extras are left out", () => {
    const card = pickCard(
      pickSummary({
        comes_with: [{ kind: "anomaly", key: "BREACHSEALER_CAT", name: "Breachsealer" }],
        comes_without: ["ambient_objects"],
      }),
      "Seddom",
      { kind: "built", extras: false },
    );
    expect(line(card, "Comes with")).toBeUndefined();
    expect(line(card, "Comes without")).toBe("Breachsealer, debris, wrecks and storms");
  });

  it("lists neither, and no missing DLC, where the game runs the layout's script", () => {
    const card = pickCard(
      pickSummary({
        comes_with: [{ kind: "anomaly", key: "BREACHSEALER_CAT", name: "Breachsealer" }],
        comes_without: ["ambient_objects"],
        dlc: { name: "Cosmic Storms", met: false },
      }),
      "Seddom",
      { kind: "script" },
    );
    expect(line(card, "Comes with")).toBeUndefined();
    expect(line(card, "Comes without")).toBeUndefined();
    expect(line(card, "DLC")).toBe("Cosmic Storms");
    expect(card.missingDlc).toBeNull();
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
    expect(line(pickCard(pickSummary({ comes_without: every }), "Seddom"), "Comes without")).toBe(
      "a pre-FTL civilisation, colonies and pops, its empire, fleets and guardians, a starbase, an anomaly, a dig site, some of its planets, debris, wrecks and storms",
    );
    expect(
      line(pickCard(pickSummary({ comes_without: ["fleets"] }), "Seddom"), "Comes without"),
    ).toBe("fleets and guardians");
  });

  it("says in a sentence of its own that a cluster's home leaves its cluster's other systems out", () => {
    const card = pickCard(pickSummary({ comes_without: ["cluster_systems", "fleets"] }), "Home");
    expect(line(card, "Comes without")).toBe("fleets and guardians");
    expect(card.clusterSystems).toBe("Its event chain also uses the other systems of its cluster.");
    expect(pickCard(pickSummary(), "Home").clusterSystems).toBeNull();
  });

  it("warns that the galaxy's own copy keeps the event chain, naming the layout", () => {
    expect(pickCard(pickSummary({ story_kept_by_existing: true }), "Tiyun Ort").storyKept).toBe(
      "Tiyun Ort is already in this galaxy, so its event chain stays with that one.",
    );
    expect(pickCard(pickSummary(), "Tiyun Ort").storyKept).toBeNull();
  });

  it("speaks of a cluster's systems together", () => {
    const stars = [
      { key: "sc_pulsar", name: "Pulsar" },
      { key: "sc_m", name: "Class M Star" },
      { key: "sc_k", name: "Class K Star" },
      { key: "sc_g", name: "Class G Star" },
    ];
    const card = pickCard(pickSummary({ star_classes: stars, story_kept_by_existing: true }), {
      phrase: "the Junk Ratlings",
    });
    expect(line(card, "Stars")).toBe("Pulsar, Class M Star, Class K Star and Class G Star");
    expect(card.storyKept).toBe(
      "The Junk Ratlings are already in this galaxy, so their event chain stays with those.",
    );
  });
});
