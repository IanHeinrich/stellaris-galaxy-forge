import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../api/ipc");
vi.mock("../../../../api/events");
vi.mock("../../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../../../../test/drawn"));

import { PLANET_ICON_KEYS, SHATTERED_ICON_SEED } from "../../../../lib/details/icons";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { planetClassView } from "../../../../test/builders";
import { drawnBy, lastDrawn } from "../../../../test/drawn";
import { Icon } from "../../../parts";
import { PlanetIcon } from "./bodies";

beforeEach(() => {
  const shattered = { ...planetClassView("pc_shattered", false), shattered: true };
  const barren = planetClassView("pc_barren", false);
  const flat = { ...planetClassView("pc_habitat", false), flat_art: true };
  const asteroid = { ...planetClassView("pc_asteroid", false), asteroid: true };
  const scar = planetClassView("pc_astral_scar", false);
  useGameDataStore.setState({
    planetClasses: new Map(
      [shattered, barren, flat, asteroid, scar].map((view) => [view.key, view]),
    ),
  });
});

function drawnIcon(
  planetClass: string,
  seed?: number,
  discFirst?: boolean,
  sprite: string | null = "GFX_planet_type_barren",
) {
  drawnBy(() =>
    renderToStaticMarkup(
      <PlanetIcon planetClass={planetClass} sprite={sprite} seed={seed} discFirst={discFirst} />,
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

  it("shows any other class's icon, then its planet disc, then the generic marker, on its tinted disc", () => {
    const icon = drawnIcon("pc_barren", 42);
    expect(icon.keys).toEqual([
      "sprite:GFX_planet_type_barren",
      "planet_disc:pc_barren",
      ...PLANET_ICON_KEYS,
    ]);
    expect(icon.className).toBe("pi");
  });

  it("falls back to the planet disc when a mod names no icon sprite, as for an icon it never defines", () => {
    expect(drawnIcon("pc_barren", 42, false, null).keys).toEqual([
      "planet_disc:pc_barren",
      ...PLANET_ICON_KEYS,
    ]);
  });

  it("leads with the planet disc when asked, as the class picker does", () => {
    expect(drawnIcon("pc_barren", 42, true).keys).toEqual([
      "planet_disc:pc_barren",
      "sprite:GFX_planet_type_barren",
      ...PLANET_ICON_KEYS,
    ]);
  });

  it.each(["random", "", "rl_unhabitable_planets"])(
    "names no disc for %j, a class the install does not define",
    (planetClass) => {
      expect(drawnIcon(planetClass, 42, false).keys).toEqual([
        "sprite:GFX_planet_type_barren",
        ...PLANET_ICON_KEYS,
      ]);
      expect(drawnIcon(planetClass, 42, true, null).keys).toEqual(PLANET_ICON_KEYS);
    },
  );

  it.each(["pc_habitat", "pc_asteroid", "pc_astral_scar"])(
    "names no disc for %s, which the map draws from its icon alone",
    (planetClass) => {
      for (const discFirst of [false, true]) {
        expect(drawnIcon(planetClass, 42, discFirst).keys).toEqual([
          "sprite:GFX_planet_type_barren",
          ...PLANET_ICON_KEYS,
        ]);
      }
    },
  );
});
