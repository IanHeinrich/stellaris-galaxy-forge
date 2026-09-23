import type { ComponentType } from "react";
import type { Capabilities } from "../../generated/Capabilities";
import { supports } from "../../lib/capabilities";
import type { DockTab } from "../../store/layoutStore";
import { Empires } from "../browser/Empires";
import { HistoryPanel } from "../browser/HistoryPanel";
import { Issues } from "../browser/Issues";
import { Points } from "../browser/Points";
import { Watchlist } from "../browser/Watchlist";
import { Inspector } from "../inspector/Inspector";

/** One dock tab: what the strip calls it, what fills the panel, and what the document must support. */
export interface DockTabEntry {
  readonly label: string;
  /** What the tab strip shows when it is narrow; `label` stays as the tooltip. */
  readonly short: string;
  readonly component: ComponentType;
  readonly requires?: keyof Capabilities;
}

/** Every dock tab, in the order the strip lists them. */
export const DOCK_TAB_REGISTRY: Record<DockTab, DockTabEntry> = {
  inspector: { label: "Inspector", short: "Inspector", component: Inspector },
  empires: { label: "Empires", short: "Empires", component: Empires, requires: "empires" },
  poi: { label: "Points of interest", short: "POI", component: Points, requires: "special" },
  watchlist: { label: "Pinned searches", short: "Pinned", component: Watchlist },
  issues: { label: "Issues", short: "Issues", component: Issues },
  changes: { label: "Changes", short: "Changes", component: HistoryPanel },
};

const ORDER = Object.keys(DOCK_TAB_REGISTRY) as DockTab[];

/** The tabs an open document can answer for, in order. */
export function dockTabsFor(capabilities: Capabilities): DockTab[] {
  return ORDER.filter((tab) => supports(capabilities, DOCK_TAB_REGISTRY[tab].requires));
}
