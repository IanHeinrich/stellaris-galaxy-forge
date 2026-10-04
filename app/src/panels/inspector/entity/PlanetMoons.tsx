import type { PlanetPageMoon } from "../../../generated/PlanetPageMoon";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { bodyEditHint } from "../../../lib/details/planetEdits";
import { capabilityFor } from "../../../lib/entities";
import { templateName } from "../../../lib/names";
import { useDetailsStore } from "../../../store/detailsStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { DrillRow, Section } from "../parts";
import { PlanetIcon, PlanetSize } from "../system/sections/bodies";
import { PlanetRow } from "../system/sections/Planets";
import { openBody } from "./openBody";
import type { PlanetSectionProps } from "./planetSection";

/** A moon of system `system` that no read system lists: its class and size, opening its own page. */
function MoonFallbackRow({ system, moon }: { system: number | null; moon: PlanetPageMoon }) {
  const names = useGameDataStore((s) => s.names);
  const classes = useGameDataStore((s) => s.planetClasses);
  const named = templateName(moon);
  const name = bodyName(moon, names);
  return (
    <DrillRow requires={capabilityFor("planet")} onOpen={() => openBody(system, moon.id, name)}>
      <PlanetIcon
        planetClass={moon.class}
        sprite={classes.get(moon.class)?.icon_sprite}
        seed={moon.id}
      />
      <span>
        <span className="l1">{name}</span>
        <span className="l2">
          {named !== "" && bodyClassName(moon.class, names)}
          {moon.size !== null && <PlanetSize size={moon.size} />}
        </span>
      </span>
    </DrillRow>
  );
}

/** The moons around the body, each opening its own page. */
export function PlanetMoons({ page }: PlanetSectionProps) {
  const read = useDetailsStore((s) =>
    page.system === null ? undefined : s.details.get(page.system),
  );
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const bodies = useCanEdit("bodies");
  if (page.moons.length === 0) return null;
  return (
    <Section id="planet.moons" title="Moons" count={page.moons.length}>
      {page.moons.map((moon) => {
        const summary = read?.planets.find((p) => p.id === moon.id);
        if (read === undefined || summary === undefined) {
          return <MoonFallbackRow key={moon.id} system={page.system} moon={moon} />;
        }
        return (
          <PlanetRow
            key={moon.id}
            planet={{ ...summary, moon: false }}
            details={read}
            editHint={bodyEditHint(summary.class, bodies, planetClasses, starClasses)}
          />
        );
      })}
    </Section>
  );
}
