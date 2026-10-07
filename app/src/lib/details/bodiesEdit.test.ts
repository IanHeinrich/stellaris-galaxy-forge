import { describe, expect, it } from "vitest";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import { planetClassView, planetPage, planetSummary } from "../../test/builders";
import { name } from "../../store/fixture";
import {
  planAddModifier,
  planClass,
  planRing,
  planSize,
  ringSpread,
  selectedBody,
  skipLine,
  type SelectedBody,
} from "./bodiesEdit";

const CLASSES = new Map(
  [
    planetClassView("pc_b_star"),
    planetClassView("pc_desert", false, null, { change: "any" }),
    planetClassView("pc_habitat", false, null, { change: "never" }),
    planetClassView("pc_frozen", false, null, { habitable: false }),
  ].map((c) => [c.key, c]),
);

function body(id: number, label: string, over: Partial<PlanetSummary>, modifiers: string[] = []) {
  const summary = planetSummary({ id, name: name(label), name_key: label, size: 16, ...over });
  const page = planetPage({
    id,
    class: summary.class,
    timed_modifiers: modifiers.map((modifier) => ({ modifier, days: -1 })),
  });
  return selectedBody(summary, page, label, {
    planetClasses: CLASSES,
    starClasses: new Map(),
    megastructures: new Set([4]),
  });
}

const BODIES: SelectedBody[] = [
  body(1, "Meissa", { class: "pc_b_star" }),
  body(2, "Meissa I", { class: "pc_desert" }),
  body(3, "Meissa III", { class: "pc_frozen" }, ["terraforming_candidate"]),
  body(4, "Meissa IV", { class: "pc_frozen" }),
  body(5, "Meissa Habitat", { class: "pc_habitat" }),
];

describe("what an edit of several bodies skips, and the line it leaves", () => {
  it("names the bodies a modifier add passes over and why", () => {
    const plan = planAddModifier(
      BODIES,
      { modifier: "terraforming_candidate", feature: null },
      null,
      "Terraforming Candidate",
      "Meissa #1",
    );
    expect(plan.note).toBe(
      "Added Terraforming Candidate to 3 planets. Skipped the star and Meissa III, which has it.",
    );
  });

  it("skips a star, a class that never changes and a planet with a megastructure for class", () => {
    expect(skipLine(BODIES, "class")).toEqual({
      text: "Skips the star, 1 planet with a megastructure and 1 planet that keeps its class.",
      title: "Meissa is a star\nMeissa IV has a megastructure\nMeissa Habitat keeps its class",
    });
    const plan = planClass(BODIES, "pc_desert", "Desert", CLASSES, "Meissa #1");
    expect(plan.op?.type === "Batch" && plan.op.ops.length).toBe(1);
    expect(plan.note).toBe(
      "Changed 1 planet to Desert. Skipped the star, 1 planet with a megastructure, 1 planet that keeps its class and Meissa I, which is already Desert.",
    );
  });

  it("says nothing changed when every body has the size already", () => {
    expect(planSize(BODIES, 16, "Meissa #1")).toEqual({ op: null, note: expect.any(String) });
    expect(planSize(BODIES, 0, "Meissa #1")).toEqual({ op: null, note: null });
  });

  it("names a planet whose class the game data doesn't list, and counts only the planets changed", () => {
    const without = new Map([...CLASSES].filter(([key]) => key !== "pc_frozen"));
    const plan = planClass(BODIES, "pc_desert", "Desert", without, "Meissa #1");
    expect(plan.op).toEqual(null);
    expect(plan.note).toBe(
      "Nothing changed. Skipped the star, 1 planet with a megastructure, 1 planet that keeps its class, Meissa I, which is already Desert and Meissa III, whose class the game data doesn't list.",
    );
  });
});

describe("the rings of several bodies", () => {
  const RINGS: SelectedBody[] = [
    body(1, "Meissa II", { class: "pc_frozen", ring: true }),
    body(2, "Meissa IIa", { class: "pc_frozen", moon: true, parent: 1, ring: true }),
    body(3, "Meissa IIb", { class: "pc_frozen", moon: true, parent: 1, ring: false }),
  ];

  it("takes a moon's ring away, and leaves out a moon without one", () => {
    expect(ringSpread(RINGS)).toEqual({ has: 2, of: 2 });
    expect(skipLine(RINGS, "ring")).toEqual({
      text: "Skips 1 moon.",
      title: "Meissa IIb is a moon without a ring",
    });
    expect(planRing(RINGS, false, "Meissa #1").op).toEqual({
      type: "Batch",
      description: "Removed the ring from 2 planets in Meissa #1",
      ops: [
        { type: "SetBodyRing", body: 1, ring: false },
        { type: "SetBodyRing", body: 2, ring: false },
      ],
    });
  });
});
