import type { BorderDefines } from "../generated/BorderDefines";
import type { BypassLink } from "../generated/BypassLink";
import type { BypassView } from "../generated/BypassView";
import type { CountryNode } from "../generated/CountryNode";
import type { CountryTypeView } from "../generated/CountryTypeView";
import type { DocumentKind } from "../generated/DocumentKind";
import type { GalaxyView } from "../generated/GalaxyView";
import type { LGate } from "../generated/LGate";
import type { MapColor } from "../generated/MapColor";
import type { NameTemplate } from "../generated/NameTemplate";
import type { Nebula } from "../generated/Nebula";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { SpecialSystem } from "../generated/SpecialSystem";
import type { StarClassView } from "../generated/StarClassView";
import type { StarbaseLevelView } from "../generated/StarbaseLevelView";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemNode } from "../generated/SystemNode";
import type { Wayline } from "../generated/Wayline";
import type { Waystation } from "../generated/Waystation";
import type { CountryTypes } from "../lib/countryKinds";
import { clanSystemsOf, NO_OWNERSHIP, type OwnerEntry, type Ownership } from "../lib/ownership";
import { bypassLinks } from "../lib/scenarioBypasses";
import {
  displayNameIn,
  nodeNameIn,
  stripped,
  templateKey,
  templateNameIn,
  type Names,
} from "../lib/names";
import { useDetailsStore } from "../store/detailsStore";
import { getPaintLayer, useFileSessionStore } from "../store/fileSessionStore";
import { useGalaxyStore } from "../store/galaxyStore";
import { useGameDataStore } from "../store/gameDataStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import { currentOwnership } from "../store/ownership";
import { SpatialGrid } from "../lib/spatialGrid";

export type Systems = ReadonlyMap<number, SystemNode>;

/** What the game writes for a vanilla install, used until its `defines` are read. */
export const VANILLA_BORDER: BorderDefines = { system_radius: 35, hyperlane_thickness: 20 };

/**
 * Everything the layers draw, as one frozen snapshot: the open save, the game data read from
 * the install, and the way to ask for the parts that are fetched lazily. The controller
 * assembles it from the stores; a layer compares the fields it cares about with the snapshot
 * it drew last to know what to redo.
 */
export interface RenderContext {
  /** The open galaxy, one object per load: what a layer keys "everything changed" on. */
  readonly galaxy: GalaxyView | null;
  /** The L-Gate outcome as edits leave it; `galaxy.lgate` is only what the save opened with. */
  readonly lgate: LGate | null;
  /** The open document's format, or null while nothing is open. */
  readonly kind: DocumentKind | null;
  /** Whether the document is written for the Paint a Galaxy mod, whose zones the map draws. */
  readonly paintLayer: boolean;
  readonly systems: Systems;
  readonly nebulae: readonly Nebula[];
  readonly bypasses: readonly BypassLink[];
  /** A save's waylines, the legs the game draws between the waystations of one network. */
  readonly waylines: readonly Wayline[];
  /** A save's waystations, by the system each one stands in. */
  readonly waystations: ReadonlyMap<number, Waystation>;
  readonly radius: number;
  /** The galaxy's core radius in world units; zero when the document sets none. */
  readonly coreRadius: number;
  readonly grid: SpatialGrid;
  readonly countries: ReadonlyMap<number, CountryNode>;
  /** Each system's owner from every source at once, and what each owner is; see `composeOwnership`. */
  readonly owners: ReadonlyMap<number, number>;
  readonly table: ReadonlyMap<number, OwnerEntry>;
  /** Owners whose territory the map leaves unpainted. */
  readonly hiddenCountries: ReadonlySet<number>;
  readonly countryName: (id: number) => string;
  /** Localised text for a name key, or its stripped form without game data. */
  readonly displayName: (key: string) => string;
  /** A system's or nebula's name, ready to draw. */
  readonly nodeName: (name: NameTemplate) => string;
  /** An entity's templated name, ready to draw; asks the backend for one it has not got. */
  readonly templateName: (named: { name: NameTemplate; name_key: string }) => string;
  readonly names: ReadonlyMap<string, string>;
  readonly starClasses: ReadonlyMap<string, StarClassView>;
  readonly mapColors: ReadonlyMap<string, MapColor>;
  readonly planetClasses: ReadonlyMap<string, PlanetClassView>;
  readonly starbaseLevels: ReadonlyMap<string, StarbaseLevelView>;
  /** Bypass kind → what `common/bypass` says about it, for the frame a bypass badge wears. */
  readonly bypassKinds: ReadonlyMap<string, BypassView>;
  readonly countryTypes: CountryTypes;
  readonly special: ReadonlyMap<number, SpecialSystem>;
  /** Each initializer's own star class, drawn for a scenario system until the game rolls one. */
  readonly initializerClasses: ReadonlyMap<string, string>;
  /** Initializer keys filtered out in the legend: their systems are dimmed and left unlabelled. */
  readonly hiddenInitializers: ReadonlySet<string>;
  /** Whether a scenario system with no name of its own is labelled with its initializer. */
  readonly initializerLabels: boolean;
  /** The empires layer is on with territories to draw, so labels give way to them as on a save. */
  readonly territoriesShown: boolean;
  /** Whether a star takes the colour of its class; without it every star is the neutral one. */
  readonly starTints: boolean;
  /** Whether a system's plate carries its owner's emblem, capital mark and colonised worlds. */
  readonly coloniesShown: boolean;
  /**
   * Systems that draw as unowned: the ones a day-one script claimed while those claims are
   * hidden. A clan's system stays the clan's whatever a day-one event claims it for.
   */
  readonly hiddenOwners: ReadonlySet<number>;
  readonly specialWithGameData: boolean;
  readonly border: BorderDefines;
  readonly gameDataReady: boolean;
  readonly details: ReadonlyMap<number, SystemDetails>;
  /** Bumped whenever `details` changes; the map is replaced with each change. */
  readonly detailsVersion: number;
  readonly resourceIcons: ReadonlyMap<string, string>;
  readonly requestDetails: (ids: Iterable<number>) => void;
  readonly requestNames: (keys: string[]) => void;
  readonly requestResourceIcons: () => void;
}

/** The fields a layer may compare between two contexts; the rest derive from them. */
const SOURCES = [
  "galaxy",
  "kind",
  "paintLayer",
  "systems",
  "nebulae",
  "bypasses",
  "waylines",
  "waystations",
  "radius",
  "coreRadius",
  "grid",
  "countries",
  "owners",
  "table",
  "hiddenCountries",
  "names",
  "starClasses",
  "mapColors",
  "planetClasses",
  "starbaseLevels",
  "bypassKinds",
  "countryTypes",
  "special",
  "initializerClasses",
  "hiddenInitializers",
  "initializerLabels",
  "starTints",
  "coloniesShown",
  "hiddenOwners",
  "specialWithGameData",
  "border",
  "gameDataReady",
  "detailsVersion",
  "resourceIcons",
] as const satisfies ReadonlyArray<keyof RenderContext>;

/** Whether two contexts draw the same map, so the layers can be left alone. */
export function sameContext(a: RenderContext, b: RenderContext): boolean {
  return SOURCES.every((key) => a[key] === b[key]);
}

const EMPTY_GRID = new SpatialGrid();
const NOTHING: never[] = [];
/** One instance, so a context built with the filter off compares equal to the last. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();
const NO_OWNERS: ReadonlySet<number> = new Set<number>();

let linkedFrom: ScenarioBypasses | null = null;
let linkedFlags = "";
let scenarioLinks: readonly BypassLink[] = NOTHING;

/** A scenario's drawn bypasses, as one instance per reading and pair of toggles. */
function linksIn(
  bypasses: ScenarioBypasses | null,
  initializers: boolean,
  dayOne: boolean,
): readonly BypassLink[] {
  const flags = `${initializers} ${dayOne}`;
  if (bypasses !== linkedFrom || flags !== linkedFlags) {
    linkedFrom = bypasses;
    linkedFlags = flags;
    scenarioLinks = bypasses === null ? NOTHING : bypassLinks(bypasses, initializers, dayOne);
  }
  return scenarioLinks;
}

let stationsFrom: readonly Waystation[] = NOTHING;
let stationsBySystem: ReadonlyMap<number, Waystation> = new Map<number, Waystation>();

/** The waystations by the system each stands in, as one map per list the save holds. */
function stationsIn(stations: readonly Waystation[]): ReadonlyMap<number, Waystation> {
  if (stations !== stationsFrom) {
    stationsFrom = stations;
    stationsBySystem = new Map(stations.map((station) => [station.system, station]));
  }
  return stationsBySystem;
}

let claimedFrom: ScenarioOwners | null = null;
let claimedSystems: ReadonlySet<number> = NO_OWNERS;

/** The systems a day-one script claimed, as one instance per set of owners. */
function claimedIn(owners: ScenarioOwners | null): ReadonlySet<number> {
  if (owners !== claimedFrom) {
    claimedFrom = owners;
    claimedSystems =
      owners === null
        ? NO_OWNERS
        : new Set(owners.owners.filter((o) => o.claimed_by !== null).map((o) => o.system));
  }
  return claimedSystems;
}

let clansFrom: Ownership = NO_OWNERSHIP;
let clanSystems: ReadonlySet<number> = NO_OWNERS;

/** The systems of the clans a scenario places, as one instance per ownership. */
function clansIn(ownership: Ownership): ReadonlySet<number> {
  if (ownership !== clansFrom) {
    clansFrom = ownership;
    const ids = clanSystemsOf(ownership);
    clanSystems = ids.size === 0 ? NO_OWNERS : ids;
  }
  return clanSystems;
}

let hiddenFrom: readonly [ReadonlySet<number>, ReadonlySet<number>] = [NO_OWNERS, NO_OWNERS];
let hiddenClaims: ReadonlySet<number> = NO_OWNERS;

/** The hidden claims less the clans' systems, as one instance per pair. */
function hiddenOwnersIn(
  claimed: ReadonlySet<number>,
  clans: ReadonlySet<number>,
): ReadonlySet<number> {
  if (claimed !== hiddenFrom[0] || clans !== hiddenFrom[1]) {
    hiddenFrom = [claimed, clans];
    if (claimed.size === 0 || clans.size === 0) hiddenClaims = claimed;
    else hiddenClaims = new Set([...claimed].filter((id) => !clans.has(id)));
  }
  return hiddenClaims;
}

export const EMPTY_CONTEXT: RenderContext = Object.freeze({
  galaxy: null,
  lgate: null,
  kind: null,
  paintLayer: false,
  systems: new Map<number, SystemNode>(),
  nebulae: NOTHING,
  bypasses: NOTHING,
  waylines: NOTHING,
  waystations: new Map<number, Waystation>(),
  radius: 0,
  coreRadius: 0,
  grid: EMPTY_GRID,
  countries: new Map<number, CountryNode>(),
  owners: NO_OWNERSHIP.owners,
  table: NO_OWNERSHIP.table,
  hiddenCountries: new Set<number>(),
  countryName: (id: number) => `#${id}`,
  displayName: stripped,
  nodeName: (name: NameTemplate) => (name.literal ? name.key : stripped(name.key)),
  templateName: (named: { name_key: string }) => stripped(named.name_key),
  names: new Map<string, string>(),
  starClasses: new Map<string, StarClassView>(),
  mapColors: new Map<string, MapColor>(),
  planetClasses: new Map<string, PlanetClassView>(),
  starbaseLevels: new Map<string, StarbaseLevelView>(),
  bypassKinds: new Map<string, BypassView>(),
  countryTypes: new Map<string, CountryTypeView>(),
  special: new Map<number, SpecialSystem>(),
  initializerClasses: new Map<string, string>(),
  hiddenInitializers: new Set<string>(),
  initializerLabels: false,
  territoriesShown: false,
  starTints: true,
  coloniesShown: true,
  hiddenOwners: NO_OWNERS,
  specialWithGameData: false,
  border: VANILLA_BORDER,
  gameDataReady: false,
  details: new Map<number, SystemDetails>(),
  detailsVersion: -1,
  resourceIcons: new Map<string, string>(),
  requestDetails: () => {},
  requestNames: () => {},
  requestResourceIcons: () => {},
});

/** The current state of the stores, as the layers see it. */
export function renderContext(): RenderContext {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  const details = useDetailsStore.getState();
  const chrome = useMapChromeStore.getState();
  const names: Names = data.names;
  const resolve = (t: NameTemplate): string | undefined => {
    const text = names.get(templateKey(t));
    if (text === undefined) data.requestName(t);
    return text;
  };
  const ready = data.status === "ready";
  const kind = useFileSessionStore.getState().kind;
  const ownership = currentOwnership();
  return Object.freeze({
    galaxy: galaxy.galaxy,
    lgate: galaxy.lgate,
    kind,
    paintLayer: getPaintLayer(),
    systems: galaxy.systems,
    nebulae: galaxy.nebulae,
    bypasses:
      kind === "scenario"
        ? linksIn(data.scenarioBypasses, chrome.layers.bypasses, chrome.layers.day_one_bypasses)
        : (galaxy.galaxy?.bypasses ?? NOTHING),
    waylines: galaxy.waylines,
    waystations: stationsIn(galaxy.waystations),
    radius: galaxy.galaxy?.galaxy_radius ?? 0,
    coreRadius: galaxy.galaxy?.core_radius ?? 0,
    grid: galaxy.grid ?? EMPTY_GRID,
    countries: galaxy.countries,
    owners: ownership.owners,
    table: ownership.table,
    hiddenCountries: galaxy.hiddenCountries,
    countryName: galaxy.countryName,
    displayName: (key: string) => displayNameIn(names, key),
    nodeName: (name: NameTemplate) => nodeNameIn(names, name),
    templateName: (named: { name: NameTemplate; name_key: string }) =>
      templateNameIn(names, ready, resolve, named),
    names,
    starClasses: data.starClasses,
    mapColors: data.mapColors,
    planetClasses: data.planetClasses,
    starbaseLevels: data.starbaseLevels,
    bypassKinds: data.bypasses,
    countryTypes: data.countryTypes,
    special: data.special,
    initializerClasses: data.initializerClasses,
    hiddenInitializers: chrome.layers.initializers ? chrome.hiddenInitializers : NO_KEYS,
    initializerLabels: kind === "scenario" && chrome.layers.initializers,
    territoriesShown: chrome.layers.owners && ownership.table.size > 0,
    starTints: chrome.layers.classes,
    coloniesShown: chrome.layers.colonies,
    hiddenOwners: hiddenOwnersIn(
      kind === "scenario" && !chrome.layers.claims ? claimedIn(data.scenarioOwners) : NO_OWNERS,
      clansIn(ownership),
    ),
    specialWithGameData: data.specialWithGameData,
    border: data.summary?.border ?? VANILLA_BORDER,
    gameDataReady: ready,
    details: details.details,
    detailsVersion: details.version,
    resourceIcons: details.resourceIcons,
    requestDetails: details.request,
    requestNames: (keys: string[]) => void data.fetchNames(keys),
    requestResourceIcons: () => void details.loadResourceIcons(),
  });
}
