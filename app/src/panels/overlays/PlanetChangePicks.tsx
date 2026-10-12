import { useMemo } from "react";
import type { MegastructurePlanetChange } from "../../generated/MegastructurePlanetChange";
import type { Names } from "../../lib/names";
import { changePlanetText, keepPlanetText, PLANET_CHANGE_LABEL } from "../../lib/planetChangeAdd";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { useNamed } from "../useNamed";

/**
 * The choice under the tiles of a type whose build changes its planet: change the planet as the
 * game does, picked on opening, or keep its class and size. It asks for the names of both classes,
 * which the dialog's note reads too.
 */
export function PlanetChangePicks({
  change,
  planetClass,
  names,
}: {
  change: MegastructurePlanetChange;
  planetClass: string | null | undefined;
  names: Names;
}) {
  const keep = useMegastructureAddStore((s) => s.keepPlanet);
  const setKeepPlanet = useMegastructureAddStore((s) => s.setKeepPlanet);
  const classKeys = useMemo(
    () => [change.class, planetClass].filter((key): key is string => typeof key === "string"),
    [change.class, planetClass],
  );
  useNamed(classKeys);

  return (
    <div role="radiogroup" aria-label={PLANET_CHANGE_LABEL} className="ring-world-planets">
      <span className="muted">{PLANET_CHANGE_LABEL}</span>
      <label>
        <input
          type="radio"
          name="megastructure-planet"
          checked={!keep}
          onChange={() => setKeepPlanet(false)}
        />
        <span>{changePlanetText(change, names)}</span>
      </label>
      <label>
        <input
          type="radio"
          name="megastructure-planet"
          checked={keep}
          onChange={() => setKeepPlanet(true)}
        />
        <span>{keepPlanetText(change, planetClass, names)}</span>
      </label>
    </div>
  );
}
