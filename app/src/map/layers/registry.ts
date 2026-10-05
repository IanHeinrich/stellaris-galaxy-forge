import type { Renderer } from "pixi.js";
import type { Capabilities } from "../../generated/Capabilities";
import { supports } from "../../lib/capabilities";
import { WorkerTerritoryClient } from "../../lib/geometry/territoryClient";
import type { DrawnPositions } from "../drawnPositions";
import {
  isSwitched,
  SCENE_ONLY_IDS,
  type LayerId,
  type MapLayerId,
} from "../../lib/visual/layerIds";
import { BypassesLayer } from "./BypassesLayer";
import { DetailsLayer } from "./DetailsLayer";
import { FeZonesLayer } from "./FeZonesLayer";
import { HeightsLayer } from "./HeightsLayer";
import { LClusterLayer, MapBorderLayer } from "./GuideLayers";
import { IssuesLayer } from "./IssuesLayer";
import { LabelsLayer } from "./LabelsLayer";
import { LanesLayer } from "./LanesLayer";
import type { MapLayer } from "./MapLayer";
import { NebulaeLayer } from "./NebulaeLayer";
import { OutcomesLayer } from "./OutcomesLayer";
import { OwnersLayer } from "./OwnersLayer";
import { PrecursorsLayer } from "./PrecursorsLayer";
import { SpawnsLayer } from "./SpawnsLayer";
import { SpecialLayer } from "./SpecialLayer";
import { SystemsLayer } from "./SystemsLayer";
import { WatchlistLayer } from "./WatchlistLayer";
import { WaylinesLayer } from "./WaylinesLayer";

/** One layer the map can draw, and the document capability it needs to be worth drawing. */
export interface LayerEntry {
  readonly id: MapLayerId;
  /** A menu-only toggle leaves this out: it steers what another layer draws, not a layer of its own. */
  create?(renderer: Renderer, drawn: DrawnPositions): MapLayer;
  /** A layer without one draws for every document. */
  readonly requires?: keyof Capabilities;
  /** The menus leave the layer out until the install has been read. */
  readonly requiresGameData?: true;
}

/** An entry the map instantiates, as opposed to a menu-only toggle. */
export interface DrawnLayerEntry extends LayerEntry {
  create(renderer: Renderer, drawn: DrawnPositions): MapLayer;
}

/**
 * Every layer the capabilities decide, in the order they are drawn. The highlights layer is
 * not here: the galaxy scene creates it once and keeps it above these, whatever the document is.
 */
export const LAYER_REGISTRY: readonly LayerEntry[] = [
  { id: "mapBorder", create: () => new MapBorderLayer() },
  { id: "lCluster", create: () => new LClusterLayer() },
  { id: "nebulae", requires: "nebulae", create: () => new NebulaeLayer() },
  { id: "feZones", requires: "create_systems", create: () => new FeZonesLayer() },
  {
    id: "owners",
    requires: "empires",
    create: () => new OwnersLayer(new WorkerTerritoryClient()),
  },
  { id: "lanes", create: (_renderer, drawn) => new LanesLayer(drawn) },
  { id: "waylines", requires: "waylines", create: (_renderer, drawn) => new WaylinesLayer(drawn) },
  { id: "claims", requires: "create_systems" },
  { id: "marauders", requires: "create_systems" },
  { id: "day_one_bypasses", requires: "create_systems" },
  { id: "bypasses", create: (_renderer, drawn) => new BypassesLayer(drawn) },
  {
    id: "heights",
    requires: "system_heights",
    create: (_renderer, drawn) => new HeightsLayer(drawn),
  },
  { id: "systems", create: (renderer, drawn) => new SystemsLayer(renderer, drawn) },
  {
    id: "outcomes",
    requires: "create_systems",
    create: (_renderer, drawn) => new OutcomesLayer(drawn),
  },
  { id: "classes" },
  {
    id: "precursors",
    requires: "precursors",
    requiresGameData: true,
    create: (_renderer, drawn) => new PrecursorsLayer(drawn),
  },
  { id: "issues", create: (_renderer, drawn) => new IssuesLayer(drawn) },
  { id: "watchlist", create: (_renderer, drawn) => new WatchlistLayer(drawn) },
  { id: "labels", create: (_renderer, drawn) => new LabelsLayer(drawn) },
  { id: "initializers", requires: "create_systems" },
  { id: "spawns", requires: "create_systems", create: () => new SpawnsLayer() },
  { id: "details", create: (_renderer, drawn) => new DetailsLayer(drawn) },
  ...SCENE_ONLY_IDS.map((id) => ({ id })),
  { id: "colonies" },
  { id: "special", requires: "special", create: (_renderer, drawn) => new SpecialLayer(drawn) },
];

/** Every entry the open document can answer for, drawn or menu-only, in draw order. */
function supportedBy(capabilities: Capabilities): LayerEntry[] {
  return LAYER_REGISTRY.filter((entry) => supports(capabilities, entry.requires));
}

/** The layers an open document can answer for, in draw order. */
export function layersFor(capabilities: Capabilities): DrawnLayerEntry[] {
  return supportedBy(capabilities).filter(
    (entry): entry is DrawnLayerEntry => entry.create !== undefined,
  );
}

/** The same, by id, for the menus that list what the map can show with the install as read. */
export function layerIdsFor(
  capabilities: Capabilities,
  gameDataReady = false,
): ReadonlySet<LayerId> {
  return new Set(
    supportedBy(capabilities)
      .filter((entry) => gameDataReady || !entry.requiresGameData)
      .map((entry) => entry.id)
      .filter(isSwitched),
  );
}
