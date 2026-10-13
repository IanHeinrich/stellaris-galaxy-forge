import {
  PLANET_ICON_KEYS,
  SHATTERED_ICON_SEED,
  planetTint,
  shatteredDiscKey,
} from "../lib/details/icons";
import { isStar } from "../lib/details/starBody";
import { toCss } from "../lib/visual/color";
import { bodyLook } from "../map/system/look";
import { useGameDataStore } from "../store/gameDataStore";
import { Icon } from "./parts";
import { useTextureUrl } from "./useTextureUrl";

/** A star's own art, its class texture when the class carries none, and a radiant glyph with neither. */
function PlanetStarIcon({ keys }: { keys: readonly string[] }) {
  const url = useTextureUrl(keys);
  if (url) {
    return (
      <span className="pi ghost">
        <img src={url} alt="" />
      </span>
    );
  }
  return (
    <span className="pi star" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <path d="M10 2.5 L11.6 8.4 L17.5 10 L11.6 11.6 L10 17.5 L8.4 11.6 L2.5 10 L8.4 8.4 Z" />
      </svg>
    </span>
  );
}

/**
 * A body's class sprite, then the class's planet disc where the map bakes one, then the map's
 * neutral planet marker, on the disc the class is tinted while none has loaded; a star wears its
 * star art so it never reads as a planet. With `discFirst` the disc leads, for a picker that shows
 * what the class looks like. A shattered class shows its shards as the map does, broken as `seed`,
 * the planet's id, says.
 */
export function PlanetIcon({
  planetClass,
  sprite,
  seed = SHATTERED_ICON_SEED,
  discFirst = false,
}: {
  planetClass: string;
  sprite: string | null | undefined;
  seed?: number;
  discFirst?: boolean;
}) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const own = sprite ? [`sprite:${sprite}`] : [];
  if (isStar({ class: planetClass }, { planetClasses, starClasses })) {
    const texture = starClasses.get(planetClass)?.texture_key;
    return <PlanetStarIcon keys={texture ? [...own, texture] : own} />;
  }
  if (planetClasses.get(planetClass)?.shattered === true) {
    return <Icon className="pi shattered" keys={[shatteredDiscKey(planetClass, seed), ...own]} />;
  }
  const view = planetClasses.get(planetClass);
  const { surfaceKeys: disc } = bodyLook({
    planetClass,
    starClass: null,
    drawn: view === undefined,
    flat: view?.flat_art === true,
    hidden: view?.hidden_model === true,
    asteroid: view?.asteroid === true,
  });
  return (
    <Icon
      className="pi"
      keys={
        discFirst ? [...disc, ...own, ...PLANET_ICON_KEYS] : [...own, ...disc, ...PLANET_ICON_KEYS]
      }
      style={{ background: toCss(planetTint(planetClass)) }}
    />
  );
}
