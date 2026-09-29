import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../api/ipc");
vi.mock("../../../../api/events");
vi.mock("../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../../test/drawn"));

import { SHATTERED_ICON_SEED } from "../../../../lib/details/icons";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { planetClassView } from "../../../../test/builders";
import { drawnBy, lastDrawn } from "../../../../test/drawn";
import { Icon } from "../../../parts";
import { PlanetIcon } from "./bodies";

beforeEach(() => {
  const shattered = { ...planetClassView("pc_shattered", false), shattered: true };
  const barren = planetClassView("pc_barren", false);
  useGameDataStore.setState({
    planetClasses: new Map([shattered, barren].map((view) => [view.key, view])),
  });
});

function drawnIcon(planetClass: string, seed?: number) {
  drawnBy(() =>
    renderToStaticMarkup(
      <PlanetIcon planetClass={planetClass} sprite="GFX_planet_type_barren" seed={seed} />,
    ),
  );
  return lastDrawn((el) => el.type === Icon, "the class icon") as {
    keys: string[];
    className: string;
  };
}

describe("PlanetIcon", () => {
  it("shows a shattered class's shards as the map breaks them, then its icon while they load", () => {
    const icon = drawnIcon("pc_shattered", 42);
    expect(icon.keys).toEqual([
      "planet_disc_shattered:pc_shattered:42",
      "sprite:GFX_planet_type_barren",
    ]);
    expect(icon.className).toBe("pi shattered");
  });

  it("breaks a shattered class by a fixed seed where no planet gives one, as in the class picker", () => {
    expect(drawnIcon("pc_shattered").keys[0]).toBe(
      `planet_disc_shattered:pc_shattered:${SHATTERED_ICON_SEED}`,
    );
  });

  it("shows any other class's icon on its tinted disc", () => {
    const icon = drawnIcon("pc_barren", 42);
    expect(icon.keys).toEqual(["sprite:GFX_planet_type_barren"]);
    expect(icon.className).toBe("pi");
  });
});
