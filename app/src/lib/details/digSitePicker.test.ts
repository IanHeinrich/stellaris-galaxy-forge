import { describe, expect, it } from "vitest";
import type { DigSiteChoice } from "../../generated/DigSiteChoice";
import type { PlanetPageDigSite } from "../../generated/PlanetPageDigSite";
import { digSiteLine, digSitePickRows, digSiteSections } from "./digSitePicker";

const CHOICES: DigSiteChoice[] = [
  {
    key: "site_repowered_complex",
    name: "Repowered Complex",
    difficulty: 2,
    stages: 1,
    rolled: false,
    offered: true,
  },
  {
    key: "site_lost_moments",
    name: "Never Forget",
    difficulty: 1,
    stages: 3,
    rolled: true,
    offered: true,
  },
  {
    key: "site_krazura_dig",
    name: "Ancient Capital Site",
    difficulty: 3,
    stages: 2,
    rolled: true,
    offered: true,
  },
  {
    key: "site_the_library",
    name: "The Library",
    difficulty: 4,
    stages: 3,
    rolled: true,
    offered: false,
  },
];

const labels = (chip: "All" | "Surveys" | "Events", query = "") =>
  digSiteSections(digSitePickRows(CHOICES), chip, query).flatMap((s) => s.rows.map((r) => r.label));

const site = (over: Partial<PlanetPageDigSite> = {}): PlanetPageDigSite => ({
  id: 4,
  kind: "site_lost_moments",
  stages_done: 0,
  clues: 0,
  excavating: false,
  ...over,
});

describe("the dig site picker's rows", () => {
  it("lists every type it offers by name under All, with its stages and how it is found", () => {
    expect(labels("All")).toEqual(["Ancient Capital Site", "Never Forget", "Repowered Complex"]);
    expect(digSitePickRows(CHOICES)[1].gives).toBe("3 stages · found by surveys");
    expect(digSitePickRows(CHOICES)[2].gives).toBe("1 stage · event only");
  });

  it("splits the types a survey finds from those only an event creates, and searches by name or key", () => {
    expect(labels("Surveys")).toEqual(["Ancient Capital Site", "Never Forget"]);
    expect(labels("Events")).toEqual(["Repowered Complex"]);
    expect(labels("All", "never")).toEqual(["Never Forget"]);
    expect(labels("All", "krazura")).toEqual(["Ancient Capital Site"]);
  });
});

describe("a site's line", () => {
  it("counts the stage from one, its clues, and says when a fleet digs", () => {
    expect(digSiteLine(site(), 3)).toBe("Stage 1 of 3 · 0 clues");
    expect(digSiteLine(site({ stages_done: 1, clues: 5, excavating: true }), 3)).toBe(
      "Stage 2 of 3 · 5 clues · Excavating",
    );
    expect(digSiteLine(site({ stages_done: 3, clues: 1 }), 3)).toBe("Finished · 1 clue");
    expect(digSiteLine(site({ stages_done: 1 }), null)).toBe("Stage 2 · 0 clues");
  });
});
