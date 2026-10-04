import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { capabilityFor } from "../../../lib/entities";
import type { Names } from "../../../lib/names";
import { cutHint, cutLabel, movingBodies, selectionLine } from "../../../lib/planetMove";
import { counted } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { type Entry } from "../../../store/inspectorStore";
import { cutAvailability, usePlanetMoveStore } from "../../../store/planetMoveStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useOpenEntity } from "../entity/useEntity";
import { DrillLink, Empty, Section } from "../parts";

/** Whether `a` and `b` hold the same ids. */
function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** What a selected body is, after its name: a moon's planet, a colony's owner or its class, and its moons. */
function bodyNote(
  body: PlanetSummary,
  planets: readonly PlanetSummary[],
  nameOf: (id: number) => string,
  countryName: (id: number) => string,
  names: Names,
): string {
  const parts: string[] = [];
  if (body.moon && body.parent !== null) parts.push(`moon of ${nameOf(body.parent)}`);
  else if (body.colonised && body.owner !== null) parts.push(`${countryName(body.owner)} colony`);
  else parts.push(bodyClassName(body.class, names));
  const moons = planets.filter((p) => p.parent === body.id).length;
  if (moons > 0) parts.push(counted(moons, "moon"));
  return parts.join(" · ");
}

/**
 * Two or more bodies selected in a system's view: what moves with them, each body with a × that
 * drops it from the selection, and Cut, or Cancel move once these planets are cut.
 */
export function BodySelectionView({ entry }: { entry: Entry }) {
  const system = entry.ref.kind === "bodies" ? entry.ref.system : null;
  const selection = useSceneStore((s) => s.bodySelection);
  const selectionTargets = usePlanetMoveStore((s) => s.selectionTargets);
  const cut = usePlanetMoveStore((s) => s.cut);
  const toggleBody = useSceneStore((s) => s.toggleBody);
  const cutSelection = usePlanetMoveStore((s) => s.cutSelection);
  const cancelCut = usePlanetMoveStore((s) => s.cancelCut);
  const read = useDetailsStore((s) => (system === null ? undefined : s.details.get(system)));
  const names = useGameDataStore((s) => s.names);
  const countryName = useGalaxyStore((s) => s.countryName);
  const opener = useOpenEntity();
  if (system === null || selection === null || selection.system !== system) {
    return <Empty>No bodies are selected.</Empty>;
  }

  const planets = read?.planets ?? [];
  const bodyOf = (id: number) => planets.find((p) => p.id === id);
  const nameOf = (id: number) => {
    const body = bodyOf(id);
    return body === undefined ? `#${id}` : bodyName(body, names);
  };
  const moving = movingBodies(selection.ids, (id) => bodyOf(id)?.parent ?? null);
  const movingSet = new Set(moving);
  const moonsAlong = planets.filter((p) => p.parent !== null && movingSet.has(p.parent)).length;
  const leaving = moving.flatMap((id) => {
    const body = bodyOf(id);
    return body?.moon && body.parent !== null
      ? [{ moon: nameOf(id), planet: nameOf(body.parent) }]
      : [];
  });

  const availability = cutAvailability(selection, selectionTargets);
  const cutPlanets = availability.kind === "ready" ? availability.planets : moving;
  const isCut = cut !== null && cut.from === system && sameIds(cut.planets, cutPlanets);

  return (
    <>
      <div className="ins-head">
        <span className="name">{counted(moving.length, "planet")}</span>
      </div>
      <div className="ins-line muted">
        <span>{selectionLine(moving.length, moonsAlong, leaving)}</span>
      </div>
      <Section id="bodies.planets" title="Planets" count={selection.ids.length}>
        {selection.ids.map((id) => {
          const body = bodyOf(id);
          const name = nameOf(id);
          return (
            <div className="ins-line ins-body-pick" key={id}>
              <span>
                <DrillLink
                  requires={capabilityFor("planet")}
                  title="Open the planet's page"
                  onOpen={() => opener.open({ kind: "planet", id }, name)}
                >
                  {name}
                </DrillLink>
                {body !== undefined && (
                  <span className="muted">
                    {" "}
                    · {bodyNote(body, planets, nameOf, countryName, names)}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="link ins-close"
                title={`Remove ${name} from the selection`}
                aria-label={`Remove ${name} from the selection`}
                onClick={() => toggleBody(system, id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </Section>
      <Section id="bodies.actions" title="Actions">
        <div className="ins-bulk">
          {isCut ? (
            <button type="button" onClick={() => cancelCut()}>
              Cancel move
            </button>
          ) : (
            <button
              type="button"
              disabled={availability.kind !== "ready"}
              title={availability.kind === "refused" ? availability.reason : undefined}
              onClick={() => cutSelection()}
            >
              {cutLabel(
                cutPlanets.map((id) => ({ name: nameOf(id), moon: bodyOf(id)?.moon === true })),
              )}
            </button>
          )}
        </div>
        <div className="muted ins-hint">{cutHint(isCut)}</div>
      </Section>
    </>
  );
}
