import { bodyEditHint } from "../../../lib/details/planetEdits";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { Section } from "../parts";
import { PlanetRow } from "../system/sections/Planets";
import type { PlanetSectionProps } from "./planetSection";

/** The moons around the body, as its system's details list them, each opening its own page. */
export function PlanetMoons({ read }: PlanetSectionProps) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const bodies = useCanEdit("bodies");
  const { details, summary } = read;
  const moons = details.planets.filter((p) => p.parent === summary.id);
  if (moons.length === 0) return null;
  return (
    <Section id="planet.moons" title="Moons" count={moons.length}>
      {moons.map((moon) => (
        <PlanetRow
          key={moon.id}
          planet={{ ...moon, moon: false }}
          details={details}
          editHint={bodyEditHint(moon.class, bodies, planetClasses, starClasses)}
        />
      ))}
    </Section>
  );
}
