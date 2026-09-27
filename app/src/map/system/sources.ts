import type { BeltKindView } from "../../generated/BeltKindView";
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
import {
  geometryAdapterFor,
  NO_GEOMETRY,
  type GeometryAdapter,
} from "../../lib/details/orbitEdits";
import { nodeNameIn, stripped, templateKey, templateNameIn } from "../../lib/names";
import { NO_OWNERSHIP, type Ownership } from "../../lib/ownership";
import type { SceneLayerId } from "../../lib/visual/layerIds";
import { shownRoll, useDetailsStore } from "../../store/detailsStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { moonScaleOf, systemRadiiOf, useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { currentOwnership } from "../../store/ownership";
import { useSceneStore } from "../../store/sceneStore";
import { sameFields } from "../follows";
import type { Systems } from "../RenderContext";

/** What the scene reads from the stores for the one system it shows. */
export interface SystemSources {
  readonly id: number | null;
  readonly systems: Systems;
  readonly details: SystemDetails | null;
  readonly names: ReadonlyMap<string, string>;
  readonly planetClasses: ReadonlyMap<string, PlanetClassView>;
  /** The install's `NGraphics.MOON_SCALE`; `VANILLA_MOON_SCALE` before game data gives one. */
  readonly moonScale: number;
  /** How the install sizes a system; `VANILLA_SYSTEM_RADII` before game data gives them. */
  readonly radii: SystemRadii;
  readonly starClasses: ReadonlyMap<string, StarClassView>;
  /** Each asteroid belt kind the game data defines, by key. */
  readonly beltKinds: ReadonlyMap<string, BeltKindView>;
  /** The star class each initializer gives its system, for a scenario system with none of its own. */
  readonly initializerClasses: ReadonlyMap<string, string>;
  readonly kind: DocumentKind | null;
  readonly gameDataReady: boolean;
  readonly resourceIcons: ReadonlyMap<string, string>;
  /** Which of the scene's switches are on: names, resources, nebula clouds and orbit radii. */
  readonly sceneLayers: Readonly<Record<SceneLayerId, boolean>>;
  /** Where the roll drawn lands the system's bodies, or the planets the game rolls; null until one is in. */
  readonly roll: SystemRoll | null;
  /** Who owns what, for the colour a colonised body's plate shows. */
  readonly ownership: Ownership;
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
  names: new Map<string, string>(),
  planetClasses: new Map<string, PlanetClassView>(),
  moonScale: VANILLA_MOON_SCALE,
  radii: VANILLA_SYSTEM_RADII,
  starClasses: new Map<string, StarClassView>(),
  beltKinds: new Map<string, BeltKindView>(),
  initializerClasses: new Map<string, string>(),
  kind: null,
  gameDataReady: false,
  resourceIcons: new Map<string, string>(),
  sceneLayers: Object.freeze({ labels: true, details: false, nebulae: false, orbitRadii: false }),
  roll: null,
  ownership: NO_OWNERSHIP,
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
  names: true,
  planetClasses: true,
  moonScale: true,
  radii: true,
  starClasses: true,
  beltKinds: true,
  initializerClasses: true,
  kind: true,
  gameDataReady: true,
  resourceIcons: true,
  sceneLayers: true,
  roll: true,
  ownership: true,
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

/** The stores' state for system `id`, as the scene reads it, asking for the roll it draws. */
export function readSystemSources(id: number | null): SystemSources {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  const details = useDetailsStore.getState();
  const { roll, lockedBodies } = useSceneStore.getState();
  const session = useFileSessionStore.getState();
  if (id !== null) details.requestRoll(id, roll);
  const names = data.names;
  const ready = data.status === "ready";
  const resolve = (t: NameTemplate): string | undefined => {
    const text = names.get(templateKey(t));
    if (text === undefined) data.requestName(t);
    return text;
  };
  return Object.freeze({
    id,
    systems: galaxy.systems,
    details: id === null ? null : (details.details.get(id) ?? null),
    names,
    planetClasses: data.planetClasses,
    moonScale: moonScaleOf(data),
    radii: systemRadiiOf(data),
    starClasses: data.starClasses,
    beltKinds: beltKindsBy(data.summary?.belt_kinds ?? NO_BELT_KINDS),
    initializerClasses: data.initializerClasses,
    kind: session.kind,
    gameDataReady: ready,
    resourceIcons: details.resourceIcons,
    sceneLayers: useMapChromeStore.getState().sceneLayers,
    roll: shownRoll(details.rolls, id),
    ownership: currentOwnership(),
    nodeName: (name: NameTemplate) => nodeNameIn(names, name),
    templateName: (named: { name: NameTemplate; name_key: string }) =>
      templateNameIn(names, ready, resolve, named),
    countryName: galaxy.countryName,
    geometry: geometryAdapterFor(documentCapabilities(session), id),
    lockedBodies,
  });
}
