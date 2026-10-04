import type { BeltKindView } from "../../generated/BeltKindView";
import type { CountryNode } from "../../generated/CountryNode";
import type { DocumentKind } from "../../generated/DocumentKind";
import type { NameTemplate } from "../../generated/NameTemplate";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemNode } from "../../generated/SystemNode";
import type { SystemRadii } from "../../generated/SystemRadii";
import { VANILLA_SYSTEM_RADII } from "../../generated/constants";
import type { SystemRoll } from "../../generated/SystemRoll";
import { documentCapabilities } from "../../lib/capabilities";
import { VANILLA_MOON_SCALE } from "../../lib/details/discs";
import type { BypassKinds } from "../../lib/details/icons";
import type { GeometryAdapter } from "../../lib/details/orbitIntent";
import { geometryAdapterFor, NO_GEOMETRY } from "../../lib/details/saveGeometry";
import { nodeNameIn, stripped, templateKey, templateNameIn } from "../../lib/names";
import { NO_OWNERSHIP, type Ownership } from "../../lib/ownership";
import type { SceneLayerId } from "../../lib/visual/layerIds";
import { shownRoll, useDetailsStore } from "../../store/detailsStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { moonScaleOf, systemRadiiOf, useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { currentOwnership, subscribeOwnership } from "../../store/ownership";
import { useSceneStore } from "../../store/sceneStore";
import { follows, sameFields, type Binding } from "../follows";
import type { Systems } from "../RenderContext";

/** A system a hyperlane leads to from the one the scene shows. */
export interface Neighbour {
  readonly node: SystemNode;
  /** The lane's length. */
  readonly length: number;
}

/** The system the scene shows, as its document holds it. */
export interface SceneSubject {
  readonly details: SystemDetails | null;
  /** Where the roll drawn lands the system's bodies, or the planets the game rolls; null until one is in. */
  readonly roll: SystemRoll | null;
  /** Its node in the open galaxy; null for a system shown outside one. */
  readonly node: SystemNode | null;
  /** The systems its hyperlanes lead to, each drawn as an exit. */
  readonly neighbours: readonly Neighbour[];
}

/** A store field the scene's sources are read from: a change to it re-reads them. */
export type SourceFollow = Binding<{ refresh(): void }, never>;

/** Where the scene reads the system it shows from, for one kind of document. */
export interface SubjectProvider {
  /** System `id`'s subject as the stores hold it, asking for the roll it draws. */
  read(id: number | null): SceneSubject;
  /** The store fields `read` reads. */
  readonly follows: readonly SourceFollow[];
}

/** What the scene reads from the stores for the one system it shows. */
export interface SystemSources extends SceneSubject {
  readonly id: number | null;
  /** The open galaxy's systems, which name a wormhole's partner. */
  readonly systems: Systems;
  readonly names: ReadonlyMap<string, string>;
  readonly planetClasses: ReadonlyMap<string, PlanetClassView>;
  /** The install's `NGraphics.MOON_SCALE`; `VANILLA_MOON_SCALE` before game data gives one. */
  readonly moonScale: number;
  /** How the install sizes a system; `VANILLA_SYSTEM_RADII` before game data gives them. */
  readonly radii: SystemRadii;
  readonly starClasses: ReadonlyMap<string, StarClassView>;
  /** Each asteroid belt kind the game data defines, by key. */
  readonly beltKinds: ReadonlyMap<string, BeltKindView>;
  /** Each bypass kind the game data defines, for the glyph a wormhole's plate shows. */
  readonly bypassKinds: BypassKinds;
  /**
   * The system's bodies are rolled from its initializer, so a system listing none draws its star
   * class's stars.
   */
  readonly rolledLayout: boolean;
  readonly gameDataReady: boolean;
  readonly resourceIcons: ReadonlyMap<string, string>;
  /** Which of the scene's switches are on: names, resources, clouds, wormholes and orbit radii. */
  readonly sceneLayers: Readonly<Record<SceneLayerId, boolean>>;
  /** Who owns what, for the colour a colonised body's plate shows. */
  readonly ownership: Ownership;
  /** Each country, for the flag a colonised body's name shows with details on. */
  readonly countries: ReadonlyMap<number, CountryNode>;
  readonly nodeName: (name: NameTemplate) => string;
  readonly templateName: (named: { name: NameTemplate; name_key: string }) => string;
  readonly countryName: (id: number) => string;
  /** How the system's bodies, belts and inner radius are edited, and whether they may be. */
  readonly geometry: GeometryAdapter;
  /** The bodies a drag keeps about what they orbit. */
  readonly lockedBodies: ReadonlySet<number>;
}

export const NO_SOURCES: SystemSources = Object.freeze({
  id: null,
  systems: new Map<number, SystemNode>(),
  details: null,
  node: null,
  neighbours: [],
  names: new Map<string, string>(),
  planetClasses: new Map<string, PlanetClassView>(),
  moonScale: VANILLA_MOON_SCALE,
  radii: VANILLA_SYSTEM_RADII,
  starClasses: new Map<string, StarClassView>(),
  beltKinds: new Map<string, BeltKindView>(),
  bypassKinds: new Map(),
  rolledLayout: false,
  gameDataReady: false,
  resourceIcons: new Map<string, string>(),
  sceneLayers: Object.freeze({
    labels: true,
    details: false,
    nebulae: false,
    bypasses: true,
    orbitRadii: false,
  }),
  roll: null,
  ownership: NO_OWNERSHIP,
  countries: new Map<number, CountryNode>(),
  nodeName: (name: NameTemplate) => (name.literal ? name.key : stripped(name.key)),
  templateName: (named: { name_key: string }) => stripped(named.name_key),
  countryName: (id: number) => `#${id}`,
  geometry: NO_GEOMETRY,
  lockedBodies: new Set<number>(),
});

/** Whether two snapshots were read from the same state, so the layers can be left alone. */
export const sameSources = sameFields<SystemSources>({
  id: true,
  systems: true,
  details: true,
  node: true,
  neighbours: true,
  names: true,
  planetClasses: true,
  moonScale: true,
  radii: true,
  starClasses: true,
  beltKinds: true,
  bypassKinds: true,
  rolledLayout: true,
  gameDataReady: true,
  resourceIcons: true,
  sceneLayers: true,
  roll: true,
  ownership: true,
  countries: true,
  geometry: true,
  lockedBodies: true,
});

const NO_BELT_KINDS: readonly BeltKindView[] = [];
const beltKindMaps = new WeakMap<readonly BeltKindView[], ReadonlyMap<string, BeltKindView>>();

/** The summary's belt kinds by key, the same map while the summary's list stands. */
function beltKindsBy(kinds: readonly BeltKindView[]): ReadonlyMap<string, BeltKindView> {
  let map = beltKindMaps.get(kinds);
  if (!map) {
    map = new Map(kinds.map((kind) => [kind.key, kind]));
    beltKindMaps.set(kinds, map);
  }
  return map;
}

const NO_NEIGHBOURS: readonly Neighbour[] = [];
const neighbourLists = new WeakMap<Systems, WeakMap<SystemNode, readonly Neighbour[]>>();

/** The systems `node`'s lanes lead to in `systems`, the same list while both stand. */
function neighboursIn(systems: Systems, node: SystemNode): readonly Neighbour[] {
  let byNode = neighbourLists.get(systems);
  if (!byNode) neighbourLists.set(systems, (byNode = new WeakMap()));
  let list = byNode.get(node);
  if (!list) {
    list = node.lanes.flatMap((lane) => {
      const other = systems.get(lane.to);
      return other ? [{ node: other, length: lane.length }] : [];
    });
    byNode.set(node, list);
  }
  return list;
}

/** System `id` of `systems`: its node, and the systems its lanes lead to. */
export function placeIn(
  systems: Systems,
  id: number | null,
): Pick<SceneSubject, "node" | "neighbours"> {
  const node = id === null ? undefined : systems.get(id);
  return node
    ? { node, neighbours: neighboursIn(systems, node) }
    : { node: null, neighbours: NO_NEIGHBOURS };
}

const refresh = (_state: unknown, view: { refresh(): void }) => view.refresh();

/** A system of the open galaxy, a save's or a scenario's, read by its id. */
const GALAXY_SUBJECT: SubjectProvider = {
  read(id) {
    const details = useDetailsStore.getState();
    if (id !== null) details.requestRoll(id, useSceneStore.getState().roll);
    return {
      details: id === null ? null : (details.details.get(id) ?? null),
      roll: shownRoll(details.rolls, id),
      ...placeIn(useGalaxyStore.getState().systems, id),
    };
  },
  follows: [
    follows(useGalaxyStore, [(s) => s.systems], refresh),
    follows(useDetailsStore, [(s) => s.details, (s) => s.version, (s) => s.rolls], refresh),
    follows(useSceneStore, [(s) => s.roll], refresh),
  ],
};

const SUBJECTS: Record<DocumentKind, SubjectProvider> = {
  save: GALAXY_SUBJECT,
  scenario: GALAXY_SUBJECT,
};

/** Where the open document's systems are read from; a galaxy's before a document opens. */
export function documentSubject(): SubjectProvider {
  const { kind } = useFileSessionStore.getState();
  return kind === null ? GALAXY_SUBJECT : SUBJECTS[kind];
}

/** Every store field `readSystemSources` reads, whichever subject it is given. */
export const SOURCE_FOLLOWS: readonly SourceFollow[] = [
  ...[...new Set(Object.values(SUBJECTS))].flatMap((subject) => subject.follows),
  follows(
    useGameDataStore,
    [
      (s) => s.names,
      (s) => s.status,
      (s) => s.planetClasses,
      (s) => s.starClasses,
      (s) => s.summary,
      (s) => s.bypasses,
    ],
    refresh,
  ),
  follows(useDetailsStore, [(s) => s.resourceIcons], refresh),
  follows(useGalaxyStore, [(s) => s.systems, (s) => s.countries], refresh),
  follows(useFileSessionStore, [(s) => s.kind, (s) => s.capabilities], refresh),
  follows(useMapChromeStore, [(s) => s.sceneLayers], refresh),
  follows(useSceneStore, [(s) => s.lockedBodies], refresh),
  { when: "change", subscribe: (view) => subscribeOwnership(() => view.refresh()) },
];

/** The stores' state for system `id`, as the scene reads it, with `subject` giving the system. */
export function readSystemSources(id: number | null, subject: SubjectProvider): SystemSources {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  const details = useDetailsStore.getState();
  const { lockedBodies } = useSceneStore.getState();
  const session = useFileSessionStore.getState();
  const capabilities = documentCapabilities(session);
  const names = data.names;
  const ready = data.status === "ready";
  const resolve = (t: NameTemplate): string | undefined => {
    const text = names.get(templateKey(t));
    if (text === undefined) data.requestName(t);
    return text;
  };
  return Object.freeze({
    id,
    ...subject.read(id),
    systems: galaxy.systems,
    names,
    planetClasses: data.planetClasses,
    moonScale: moonScaleOf(data),
    radii: systemRadiiOf(data),
    starClasses: data.starClasses,
    beltKinds: beltKindsBy(data.summary?.belt_kinds ?? NO_BELT_KINDS),
    bypassKinds: data.bypasses,
    rolledLayout: capabilities.rolled_layout,
    gameDataReady: ready,
    resourceIcons: details.resourceIcons,
    sceneLayers: useMapChromeStore.getState().sceneLayers,
    ownership: currentOwnership(),
    countries: galaxy.countries,
    nodeName: (name: NameTemplate) => nodeNameIn(names, name),
    templateName: (named: { name: NameTemplate; name_key: string }) =>
      templateNameIn(names, ready, resolve, named),
    countryName: galaxy.countryName,
    geometry: geometryAdapterFor(session.kind, capabilities, id),
    lockedBodies,
  });
}
