import { describe, expect, it } from "vitest";
import { planetClassView, planetSummary } from "../../../test/builders";
import { mapContext } from "../contextFixture";
import type { Textures } from "./cell";
import { planetLines } from "./planets";

const LOADED: Textures = {
  texture: (key) => (key === "sprite:GFX_planet_type_pulsar" ? ({} as never) : null),
  resolve: () => null,
};

describe("a planet's tooltip line", () => {
  it("shows a scenario pulsar by the planet class its details give it, as a save's", () => {
    const ctx = mapContext([], {
      planetClasses: new Map([
        ["pc_pulsar", { ...planetClassView("pc_pulsar"), icon_sprite: "GFX_planet_type_pulsar" }],
      ]),
      names: new Map([["pc_pulsar", "Pulsar"]]),
    });
    const star = planetSummary({ class: "pc_pulsar", habitable: false, size: 30 });
    expect(planetLines(ctx, LOADED, [star])).toEqual([
      {
        label: [{ icon: "sprite:GFX_planet_type_pulsar" }, ` ${ctx.templateName(star)}`],
        value: "Pulsar · size 30",
        stacked: true,
      },
    ]);
  });
});
