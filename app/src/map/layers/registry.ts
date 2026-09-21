import type { Renderer } from "pixi.js";
import type { Capabilities } from "../../generated/Capabilities";
import { supports } from "../../lib/capabilities";
import { WorkerTerritoryClient } from "../../lib/geometry/territoryClient";
import type { LayerId } from "../../lib/visual/layerIds";
import { BypassesLayer } from "./BypassesLayer";
import { DetailsLayer } from "./DetailsLayer";
import { FeZonesLayer } from "./FeZonesLayer";
import { LClusterLayer, MapBorderLayer } from "./GuideLayers";
import { IssuesLayer } from "./IssuesLayer";
import { LabelsLayer } from "./LabelsLayer";
import { LanesLayer } from "./LanesLayer";
import type { MapLayer } from "./MapLayer";
import { MarauderLayer, MarauderTerritoryLayer } from "./MarauderLayer";
import { NebulaeLayer } from "./NebulaeLayer";
import { OwnersLayer } from "./OwnersLayer";
import { SpawnsLayer } from "./SpawnsLayer";
import { SpecialLayer } from "./SpecialLayer";
import { SystemsLayer } from "./SystemsLayer";
import { WaylinesLayer } from "./WaylinesLayer";

/** One layer the map can draw, and the document capability it needs to be worth drawing. */
export interface LayerEntry {
  readonly id: LayerId;
  /** A menu-only toggle leaves this out: it steers what another layer draws, not a layer of its own. */
  create?(renderer: Renderer): MapLayer;
  /** A layer without one draws for every document. */
  readonly requires?: keyof Capabilities;
}

/** An entry the map instantiates, as opposed to a menu-only toggle. */
export interface DrawnLayerEntry extends LayerEntry {
  create(renderer: Renderer): MapLayer;
}

/**
 * Every layer the capabilities decide, in the order they are drawn. The highlights layer is
 * not here: the controller creates it once and keeps it above these, whatever the document is.
 */
export const LAYER_REGISTRY: readonly LayerEntry[] = [
  { id: "mapBorder", create: () => new MapBorderLayer() },
  { id: "lCluster", create: () => new LClusterLayer() },
  { id: "nebulae", requires: "nebulae", create: () => new NebulaeLayer() },
  { id: "feZones", requires: "create_systems", create: () => new FeZonesLayer() },
  { id: "marauders", requires: "create_systems", create: () => new MarauderTerritoryLayer() },
  { id: "lanes", create: () => new LanesLayer() },
  { id: "waylines", requires: "waylines", create: () => new WaylinesLayer() },
  {
    id: "owners",
    requires: "empires",
    create: () => new OwnersLayer(new WorkerTerritoryClient()),
  },
  { id: "claims", requires: "create_systems" },
  { id: "day_one_bypasses", requires: "create_systems" },
  { id: "bypasses", create: () => new BypassesLayer() },
  { id: "systems", create: (renderer) => new SystemsLayer(renderer) },
  { id: "classes" },
  { id: "issues", create: () => new IssuesLayer() },
  { id: "labels", create: () => new LabelsLayer() },
  { id: "initializers", requires: "create_systems" },
  { id: "spawns", requires: "create_systems", create: () => new SpawnsLayer() },
  { id: "marauders", requires: "create_systems", create: () => new MarauderLayer() },
  { id: "details", create: () => new DetailsLayer() },
  { id: "colonies" },
  { id: "special", requires: "special", create: () => new SpecialLayer() },
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

/** The same, by id, for the menus that list what the map can show. */
export function layerIdsFor(capabilities: Capabilities): ReadonlySet<LayerId> {
  return new Set(supportedBy(capabilities).map((entry) => entry.id));
}
