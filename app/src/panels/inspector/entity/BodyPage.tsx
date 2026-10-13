import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import type { Bounds } from "../../../generated/Bounds";
import type { DocumentKind } from "../../../generated/DocumentKind";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { bodyClassName, bodyName, shownBodyName } from "../../../lib/details/labels";
import { isStar } from "../../../lib/details/starBody";
import type { PlanetEditAdapter } from "../../../lib/details/picker";
import { overviewParts, planetPageOffers } from "../../../lib/details/planetOffers";
import { hasRingCheckbox } from "../../../lib/details/ring";
import { ringValue } from "../../../lib/details/scenarioValues";
import { neverSpawns } from "../../../lib/details/spawnFacts";
import { COLONY_SIZE } from "../../../lib/details/planetEdits";
import { documentCapabilities } from "../../../lib/capabilities";
import { bodyOrbit } from "../../../lib/details/orbitIntent";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { canEnterSystem, useBodyShown, useSceneStore } from "../../../store/sceneStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { Chip } from "../../parts";
import { EditBlock, EditKey, EditRow, TextField, ToggleField } from "../../EditField";
import { useNamed } from "../../useNamed";
import { Empty, Properties, PropertyRow } from "../parts";
import { StarRowIcon } from "../../StarIcon";
import { NeverPlaced, StateValue } from "../states";
import { READING_STARS } from "../system/StarClassLine";
import { PlanetIcon, PlanetSize } from "../system/sections/bodies";
import { BodyChips } from "./BodyChips";
import { BODY_SOURCES, type BodyRead, type Listed } from "./bodySources";
import { EntityView } from "./EntityView";
import { InitializerSource } from "./InitializerSource";
import { OrbitBlock } from "./OrbitBlock";
import { PlanetAbout } from "./PlanetAbout";
import { bodySize, rangeText } from "./bodyFields";
import { PlanetAnomaly } from "./PlanetAnomaly";
import { PlanetColony } from "./PlanetColony";
import { PlanetDigSite } from "./PlanetDigSite";
import { PlanetDeposits } from "./PlanetDeposits";
import { PlanetClassField } from "./PlanetClassField";
import { PlanetModifiers } from "./PlanetModifiers";
import { PlanetMoons } from "./PlanetMoons";
import { RemovalAction } from "./PlanetRemoval";
import { PlanetModelField } from "./PlanetModelField";
import type { PlanetSectionProps } from "./planetSection";
import { PlanetSystemField } from "./PlanetSystemField";
import {
  BodyFlags,
  BodyInitializer,
  ClassDependent,
  SpawnHeadNotes,
  SpawnProperties,
} from "./SpawnFacts";
import { SizeField, StarBlock } from "./StarBlock";
import { useGivenNames } from "./useBodyName";
import { useClassPreview } from "./useClassPreview";
import "./entity.css";

/** Asks for the game data the page shows: its deposits, modifiers, designations, anomaly, dig site and class names. */
function usePlanetData(read: BodyRead): void {
  const generation = usePlanetDataStore((s) => s.generation);
  const { dataKeys } = read;
  useEffect(() => {
    usePlanetDataStore.getState().request(dataKeys);
  }, [dataKeys, generation]);
  const moons = read.details.planets.filter((p) => p.parent === read.summary.id);
  useNamed([read.summary.class, ...moons.map((m) => m.class)]);
}

/** Whether `body` is a star: drawn as a star class, or of a class the game flags a star. */
function useIsStar(body: PlanetSummary | null): boolean {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  if (body === null) return false;
  return isStar(body, { planetClasses, starClasses });
}

/** Opens the system view on body `body` of `system`, unless it can't open or already shows the body selected. */
function ShowInSystemView({ system, body }: { system: number; body: number }) {
  const enterable = useFileSessionStore(canEnterSystem);
  const shown = useBodyShown(system, body);
  const goToBody = useSceneStore((s) => s.goToBody);
  if (!enterable || shown) return null;
  return (
    <button type="button" className="link ins-head-action" onClick={() => goToBody(system, body)}>
      Show in system view
    </button>
  );
}

/**
 * The body's icon, name and the chips that say who lives there; a save's entity id beside them,
 * and `action` at the end of the line.
 */
function Head({
  name,
  body,
  id,
  action,
}: {
  name: string;
  body: PlanetSummary | null;
  id: number | null;
  action?: ReactNode;
}) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const own = body?.star_class === undefined ? undefined : starClasses.get(body.star_class);
  const star = useIsStar(body);
  return (
    <div className={`ins-head${star ? " ins-star-head" : " pl-head"}`}>
      {body !== null &&
        (star ? (
          own && <StarRowIcon view={own} />
        ) : (
          <PlanetIcon
            planetClass={body.class}
            sprite={planetClasses.get(body.class)?.icon_sprite}
            seed={body.id}
          />
        ))}
      <span className="name">{name}</span>
      {id !== null && <span className="muted mono">#{id}</span>}
      {body?.colonised && <Chip>colonised</Chip>}
      {body !== null && <BodyChips body={body} />}
      {neverSpawns(body?.spawn) && <NeverPlaced />}
      {action}
    </div>
  );
}

/** What the fields of a planet's block show; each is `null` where the page does not offer it. */
interface PlanetFields {
  /** The body's name as the page heads it. */
  name: string | null;
  /** The body's size, and the Size field's hover text on a colony. */
  size: { value: Bounds | null; title?: string } | null;
  /** Its class, and whether a colony or a moon narrows the classes it may take. */
  planetClass: { current: string; colonised: boolean; moon: boolean } | null;
  /** Its class and the model it has in place of the class's own. */
  model: { planetClass: string; current: string | null } | null;
  /** Whether it has a ring. */
  ring: boolean | null;
  /** The system it moves from. */
  system: number | null;
}

/** Whether a planet's block has any field to show. */
function hasFields(fields: PlanetFields): boolean {
  return Object.values(fields).some((field) => field !== null);
}

/** Planet `id`'s fields, each sent to `edits`. */
function PlanetBlock({
  id,
  edits,
  fields: { name, size, planetClass, model, ring, system },
}: {
  id: number;
  edits: PlanetEditAdapter;
  fields: PlanetFields;
}) {
  return (
    <EditBlock title="Planet">
      {name !== null && (
        <EditRow label="Name">
          <TextField
            kind="text"
            label="Name"
            title="Rename this planet. Its moons named after it follow."
            value={name}
            onCommit={(text) => void edits.rename(text, name)}
          />
        </EditRow>
      )}
      {size !== null && (
        <EditRow label="Size">
          <SizeField edits={edits} size={size.value} title={size.title} />
        </EditRow>
      )}
      {planetClass !== null && (
        <PlanetClassField
          bodies={[
            {
              id,
              name: name ?? "",
              class: planetClass.current,
              colonised: planetClass.colonised,
              moon: planetClass.moon,
            },
          ]}
          edits={edits}
        />
      )}
      {model !== null && (
        <PlanetModelField edits={edits} planetClass={model.planetClass} current={model.current} />
      )}
      {ring !== null && (
        <ToggleField
          label="Ring"
          title="Draws a ring around this body"
          checked={ring}
          onChange={(on) => void edits.setRing(on)}
        />
      )}
      {system !== null && <PlanetSystemField id={id} system={system} />}
    </EditBlock>
  );
}

/** The page's Delete, where the page offers removal. */
function DeleteSection({ read, offers }: PlanetSectionProps) {
  const names = useGameDataStore((s) => s.names);
  if (!offers.pageRemoval) return null;
  return (
    <RemovalAction
      target={{
        kind: "planet",
        system: read.details.id,
        id: read.summary.id,
        name: bodyName(read.summary, names),
        moon: read.summary.moon,
        class: read.summary.class,
      }}
    />
  );
}

/**
 * What the page lists below its fields, in order; each leaves itself out where it has nothing to
 * show. Those that `pooled` list what the body rolls, which the class picked decides.
 */
const SECTIONS: readonly {
  id: string;
  Component: ComponentType<PlanetSectionProps>;
  pooled?: true;
}[] = [
  { id: "deposits", Component: PlanetDeposits, pooled: true },
  { id: "modifiers", Component: PlanetModifiers, pooled: true },
  { id: "anomaly", Component: PlanetAnomaly },
  { id: "digSite", Component: PlanetDigSite },
  { id: "colony", Component: PlanetColony },
  { id: "about", Component: PlanetAbout },
  { id: "moons", Component: PlanetMoons },
  { id: "flags", Component: BodyFlags },
  { id: "initializer", Component: BodyInitializer },
  { id: "delete", Component: DeleteSection },
];

/**
 * A body's Overview: a star's own fields first, then what the body is, holds and carries, who
 * lives there, where it is and the moons around it.
 */
function BodyOverview({ read: listedRead }: { read: BodyRead }) {
  const preview = useClassPreview(listedRead);
  const read = preview.read;
  usePlanetData(read);
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const capabilities = useFileSessionStore((s) => documentCapabilities(s));
  const { details, summary, target } = read;
  const system = useGalaxyStore((s) => s.systems.get(details.id));
  const given = useGivenNames(details);
  const star = useIsStar(summary);
  const offers = planetPageOffers(capabilities, {
    star,
    ringable:
      read.listed &&
      hasRingCheckbox(
        { class: summary.class, moon: summary.moon, ring: summary.ring === true },
        planetClasses,
        starClasses,
      ),
    moonHost: false,
  });
  const name = shownBodyName(summary, given, names);
  const size = bodySize(summary);
  const parts = overviewParts(offers, {
    star,
    listed: read.listed,
    sized: size !== null,
    systemRead: system !== undefined,
  });
  const fields: PlanetFields = {
    name: offers.planetFields ? name : null,
    size: offers.planetFields
      ? { value: size, title: summary.colonised ? COLONY_SIZE : undefined }
      : null,
    planetClass: offers.planetClass
      ? { current: summary.class, colonised: summary.colonised, moon: summary.moon }
      : null,
    model: offers.planetClass
      ? { planetClass: summary.class, current: summary.entity_name ?? null }
      : null,
    ring: offers.ring ? summary.ring === true : null,
    system: offers.move ? details.id : null,
  };
  const editsAny = offers.deposits || offers.modifiers || offers.digSite || offers.anomaly;
  const { layout, editing } = useSystemGeometry(details.id);
  const own = editing.bodies.get(summary.id);
  const orbitEdited =
    (bodyOrbit(layout, summary.id) !== null && own?.move === true) || own?.detachOnly === true;
  return (
    <>
      <Head
        name={name}
        body={summary}
        id={read.page === null ? null : summary.id}
        action={read.listed && <ShowInSystemView system={details.id} body={summary.id} />}
      />
      {hasFields(fields) && <PlanetBlock id={summary.id} edits={target.edits} fields={fields} />}
      {parts.starBlock && system !== undefined && (
        <StarBlock planet={summary} system={system} edits={target.edits} />
      )}
      {parts.starWait && <Empty>{READING_STARS}</Empty>}
      <SpawnHeadNotes read={read} />
      <OrbitBlock system={details.id} body={summary.id} />
      {summary.spawn !== undefined && (
        <SpawnProperties read={read} spawn={summary.spawn} star={star} preview={preview} />
      )}
      {summary.spawn === undefined && (parts.classRow || parts.sizeRow || parts.ringRow) && (
        <Properties>
          {parts.classRow && (
            <PropertyRow label="Class">
              {summary.drawn ? "random" : bodyClassName(summary.class, names)}
            </PropertyRow>
          )}
          {parts.sizeRow && size !== null && (
            <PropertyRow label="Size">
              <PlanetSize size={rangeText(size)} />
            </PropertyRow>
          )}
          {parts.ringRow && (
            <PropertyRow label="Ring">
              <StateValue value={ringValue(undefined, summary.ring)} />
            </PropertyRow>
          )}
        </Properties>
      )}
      {SECTIONS.map(({ id, Component, pooled }) => (
        <ClassDependent key={id} busy={pooled === true && preview.busy}>
          <Component read={read} offers={offers} orbitEdited={orbitEdited} />
        </ClassDependent>
      ))}
      {(parts.starBlock || hasFields(fields) || editsAny || orbitEdited) && <EditKey />}
    </>
  );
}

/** Body `id` in system `system`'s read details, asked for while the page is up. */
function useListed(system: number, id: number): Listed {
  const details = useDetailsStore((s) => s.details.get(system));
  const failed = useDetailsStore((s) => s.failed.get(system));
  const request = useDetailsStore((s) => s.request);
  const version = useDetailsStore((s) => s.version);
  useEffect(() => {
    request([system]);
  }, [system, request, version]);
  return useMemo(() => {
    if (details === undefined) {
      return { waiting: failed ?? "Reading the system…", settled: failed !== undefined };
    }
    const summary = details.planets.find((p) => p.id === id);
    if (summary === undefined) {
      return { waiting: "This body is not in the system any more.", settled: true };
    }
    return { details, summary };
  }, [details, failed, id]);
}

/**
 * A body's page, read through the source of the open document's kind. Its Source tab, where the
 * generic entity view has none, is its system's initializer with the body's block marked.
 */
export function BodyPage({
  entry,
  kind,
  system,
  id,
}: {
  entry: Entry;
  kind: DocumentKind;
  system: number;
  id: number;
}) {
  const tab = useInspectorStore((s) => s.tab);
  const listed = useListed(system, id);
  const source = BODY_SOURCES[kind];
  const answer = source.useRead(system, id, listed);
  if ("generic" in answer) return <EntityView entry={entry} />;
  if ("waiting" in answer) {
    return (
      <>
        <Head name={entry.label} body={null} id={source.entityTabs ? id : null} />
        <Empty>{answer.waiting}</Empty>
      </>
    );
  }
  if (tab === "source") {
    const { summary } = answer.read;
    return (
      <>
        <Head name={entry.label} body={summary} id={null} />
        <InitializerSource system={system} spawn={summary.spawn} />
      </>
    );
  }
  return <BodyOverview read={answer.read} />;
}
