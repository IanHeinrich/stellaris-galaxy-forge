import { describe, expect, it } from "vitest";
import { clusterMember } from "../test/builders";
import { clusterPlacement } from "./specialPicks";

describe("a cluster's preview", () => {
  it("draws the systems that fit with their lanes, and a refused one apart with none", () => {
    const preview = clusterPlacement({
      members: [
        clusterMember("Home", { x: 0, y: 0, star_class: "sc_pulsar" }),
        clusterMember("Near", { x: 40, y: 0, refused: "Too close to Ostrava" }),
        clusterMember("Far", { x: 0, y: 60, star_class: "sc_k" }),
      ],
      lanes: [
        [0, 1],
        [0, 2],
      ],
    });
    expect(preview.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 60 },
    ]);
    expect(preview.classes).toEqual(["sc_pulsar", "sc_k"]);
    expect(preview.pairs).toEqual([[-2, -1]]);
    expect(preview.outside).toEqual([{ x: 40, y: 0 }]);
  });
});
