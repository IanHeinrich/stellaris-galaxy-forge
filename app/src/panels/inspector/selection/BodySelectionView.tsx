import type { ReactNode } from "react";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { bodyClassName } from "../../../lib/details/labels";
import { documentCapabilities } from "../../../lib/capabilities";
import { capabilityFor } from "../../../lib/entities";
import type { Names } from "../../../lib/names";
import { copyLabel, cutHint, cutLabel, movingBodies, selectionLine } from "../../../lib/planetMove";
import { counted } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodyEntry, useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { cutAvailability, cutPlanets, usePlanetMoveStore } from "../../../store/planetMoveStore";
import { useSceneStore, type BodySelection } from "../../../store/sceneStore";
import { useSystemBodyNamer } from "../entity/useBodyName";
import { DrillLink, Empty, Section } from "../parts";
import { BodySelectionFields } from "./BodySelectionFields";

/** Past this many bodies the list shows the first `FOLDED_SHOWN` and a line to show the rest. */
const FOLD_PAST = 6;
const FOLDED_SHOWN = 5;
const FOLD_SECTION = "bodies.planets.all";

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

/** One selected body of `system`: its name, opening its page, what it is, and a × that drops it. */
function SelectedBody({
  system,
  id,
  name,
  children,
}: {
  system: number;
  id: number;
  name: string;
  children: ReactNode;
}) {
  const open = useInspectorStore((s) => s.open);
  const toggleBody = useSceneStore((s) => s.toggleBody);
  return (
    <div className="ins-line ins-body-pick">
      <span>
        <DrillLink
          requires={capabilityFor("planet")}
          title="Open the planet's page"
          onOpen={() => open(bodyEntry(system, id, name))}
        >
          {name}
        </DrillLink>
        {children}
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
}

/**
 * Two or more bodies selected in a system's view: what moves with them, each body with a × that
 * drops it from the selection, Cut, or Cancel move once these planets are cut, and in a save the
 * planet page's fields for all of them at once.
 */
export function BodySelectionView({ entry }: { entry: Entry }) {
  const system = entry.ref.kind === "bodies" ? entry.ref.system : null;
  const selection = useSceneStore((s) => s.bodySelection);
  if (system === null || selection === null || selection.system !== system) {
    return <Empty>No bodies are selected.</Empty>;
  }
  return <SelectedBodies selection={selection} />;
}

/** The summary of `selection`, two or more bodies of one system. */
function SelectedBodies({ selection }: { selection: BodySelection }) {
  const { system } = selection;
  const selectionTargets = usePlanetMoveStore((s) => s.selectionTargets);
  const cut = usePlanetMoveStore((s) => s.cut);
  const cutSelection = usePlanetMoveStore((s) => s.cutSelection);
  const cancelCut = usePlanetMoveStore((s) => s.cancelCut);
  const copySelection = usePlanetMoveStore((s) => s.copySelection);
  const copies = useFileSessionStore((s) => documentCapabilities(s).add_bodies);
  const read = useDetailsStore((s) => s.details.get(system));
  const names = useGameDataStore((s) => s.names);
  const countryName = useGalaxyStore((s) => s.countryName);
  const nameIn = useSystemBodyNamer(system);

  const planets = read?.planets ?? [];
  const bodyOf = (id: number) => planets.find((p) => p.id === id);
  const nameOf = (id: number) => nameIn(id) ?? `#${id}`;
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
  const taken = cutPlanets(selection, selectionTargets, read);
  const isCut = cut !== null && cut.from === system && sameIds(cut.planets, taken);
  const save = useFileSessionStore((s) => s.kind === "save");
  const folded = useInspectorStore((s) => s.sections[FOLD_SECTION] ?? true);
  const toggleSection = useInspectorStore((s) => s.toggleSection);
  const foldable = selection.ids.length > FOLD_PAST;
  const listed = foldable && folded ? selection.ids.slice(0, FOLDED_SHOWN) : selection.ids;

  return (
    <>
      <div className="ins-head">
        <span className="name">{counted(moving.length, "planet")}</span>
      </div>
      <div className="ins-line muted">
        <span>{selectionLine(moving.length, moonsAlong, leaving)}</span>
      </div>
      <Section
        id="bodies.planets"
        title="Planets"
        count={selection.ids.length}
        action={
          foldable && (
            <button
              type="button"
              className="link"
              onClick={() => toggleSection(FOLD_SECTION, true)}
            >
              {folded ? `Show all ${selection.ids.length}` : "Show fewer"}
            </button>
          )
        }
      >
        {listed.map((id) => {
          const body = bodyOf(id);
          return (
            <SelectedBody key={id} system={system} id={id} name={nameOf(id)}>
              {body !== undefined && (
                <span className="muted">
                  {" "}
                  · {bodyNote(body, planets, nameOf, countryName, names)}
                </span>
              )}
            </SelectedBody>
          );
        })}
        {foldable && folded && (
          <div className="ins-line muted">and {selection.ids.length - FOLDED_SHOWN} more</div>
        )}
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
              {cutLabel(taken.map((id) => ({ name: nameOf(id), moon: bodyOf(id)?.moon === true })))}
            </button>
          )}
          {copies && (
            <button type="button" onClick={() => void copySelection()}>
              {copyLabel(
                moving.map((id) => ({ name: nameOf(id), moon: bodyOf(id)?.moon === true })),
              )}
            </button>
          )}
        </div>
        <div className="muted ins-hint">{cutHint(isCut)}</div>
      </Section>
      {save && <BodySelectionFields selection={selection} read={read} />}
    </>
  );
}
