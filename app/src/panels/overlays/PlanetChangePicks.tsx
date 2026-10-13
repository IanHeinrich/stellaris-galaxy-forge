import { useMemo } from "react";
import type { MegastructurePlanetChange } from "../../generated/MegastructurePlanetChange";
import type { Names } from "../../lib/names";
import { changePlanetText, keepPlanetText, PLANET_CHANGE_LABEL } from "../../lib/planetChangeAdd";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { useNamed } from "../useNamed";
import { RadioChoice } from "./RadioChoice";

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
    <RadioChoice
      label={PLANET_CHANGE_LABEL}
      name="megastructure-planet"
      options={[
        {
          key: "change",
          label: changePlanetText(change, names),
          checked: !keep,
          onPick: () => setKeepPlanet(false),
        },
        {
          key: "keep",
          label: keepPlanetText(change, planetClass, names),
          checked: keep,
          onPick: () => setKeepPlanet(true),
        },
      ]}
    />
  );
}
