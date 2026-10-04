import { create } from "zustand";
import type { EntityAddr } from "../generated/EntityAddr";
import type { Capabilities } from "../generated/Capabilities";
import type { EntityKind } from "../generated/EntityKind";
import { documentCapabilities } from "../lib/capabilities";
import { renumberedId, renumberedLane, type Renumbering } from "../lib/renumber";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useLayoutStore, type DockTab } from "./layoutStore";
import { PREF_KEYS } from "./prefKeys";
import { isBooleanRecord, prefField } from "./prefs";

export const INSPECTOR_TABS = [
  "overview",
  "scripts",
  "contents",
  "lanes",
  "data",
  "source",
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export const INSPECTOR_TAB_LABELS: Record<InspectorTab, string> = {
  overview: "Overview",
  scripts: "Scripts",
  contents: "Contents",
  lanes: "Lanes",
  data: "Data",
  source: "Source",
};

/** What the inspector is looking at. The first five come from the map, the rest from a drill-down. */
export type EntityRef =
  | { kind: "galaxy" }
  | { kind: "selection" }
  /** Two or more bodies selected in one system's view, above that system's page. */
  | { kind: "bodies"; system: number }
  | { kind: "lane"; a: number; b: number }
  | { kind: "nebula"; index: number }
  | { kind: "system"; id: number }
  | { kind: "planet"; id: number }
  | { kind: "colony"; id: number }
  | { kind: "fleet"; id: number }
  | { kind: "ship"; id: number }
  /** The station is keyed by its own id; the system it stands in is what the map focuses. */
  | { kind: "starbase"; system: number; id: number }
  | { kind: "megastructure"; id: number }
  | { kind: "country"; id: number }
  | { kind: "pop_group"; id: number }
  | { kind: "sector"; id: number }
  | { kind: "deposit"; id: number }
  /** A natural wormhole or shroud tunnel, keyed by its own id; the map focuses its system. */
  | { kind: "wormhole"; system: number; id: number }
  /** A scenario's body: its id is the details' own, so it is keyed by the system that lists it. */
  | { kind: "body"; system: number; id: number }
  /** A list or block inside an entity: a Data row drills into it rather than nesting. */
  | { kind: "nodelist"; parent: EntityAddr; path: string[]; of: EntityKind | null };

export interface Entry {
  ref: EntityRef;
  /** The breadcrumb text; the entity's name where it has one. */
  label: string;
  /** The dock tab the page was opened from, which Back returns to. */
  from?: DockTab;
}

export const GALAXY_ENTRY: Entry = { ref: { kind: "galaxy" }, label: "Galaxy" };

/** The ref of kind `K`. */
type RefOf<K extends EntityRef["kind"]> = Extract<EntityRef, { kind: K }>;

/** Which tabs a kind's page offers; `tabsFor` turns it into the list. */
type TabPlan = "overview" | "data" | "system" | "wormhole" | "entity";

/**
 * Where a ref's page lives, as an edit asks whether it touched it: in `systems`, in the cached
 * details of whichever system lists it under `listedIn`, or nowhere an edit reaches.
 */
export type RefHome =
  | { systems: readonly number[] }
  | { listedIn: "planets" | "fleets_present" | "megastructures"; id: number }
  | null;

/** What the inspector does with a ref of one kind. */
interface RefKind<R extends EntityRef> {
  key(ref: R): string;
  /** The entity it reads from, or null for what the map alone knows about. */
  addr(ref: R): EntityAddr | null;
  tabs: TabPlan;
  /** The ref with the system ids it names moved as `pairs` move them; null when its system is gone. */
  renumber(ref: R, pairs: Renumbering): R | null;
  home(ref: R): RefHome;
}

const unmoved = <R extends EntityRef>(ref: R) => ref;
const nothing = () => null;
const byId = (ref: { kind: string; id: number }) => `${ref.kind}:${ref.id}`;
const addrOf = (ref: { kind: EntityKind; id: number }): EntityAddr => ({
  kind: ref.kind,
  id: ref.id,
});

/** A ref that only the map knows about, with no system to follow. */
function mapOnly<R extends EntityRef>(key: (ref: R) => string): RefKind<R> {
  return { key, addr: nothing, tabs: "overview", renumber: unmoved, home: nothing };
}

/** A ref in a system it names, whose page goes when the system goes. */
function inSystem<R extends EntityRef & { system: number }>(
  key: (ref: R) => string,
  addr: (ref: R) => EntityAddr | null,
  tabs: TabPlan,
): RefKind<R> {
  return {
    key,
    addr,
    tabs,
    renumber(ref, pairs) {
      const system = renumberedId(pairs, ref.system);
      return system === null ? null : system === ref.system ? ref : { ...ref, system };
    },
    home: (ref) => ({ systems: [ref.system] }),
  };
}

/** An entity read by its id, whose page no renumbering moves. */
function entity<R extends EntityRef & { kind: EntityKind; id: number }>(
  home: (ref: R) => RefHome = nothing,
): RefKind<R> {
  return { key: byId, addr: addrOf, tabs: "entity", renumber: unmoved, home };
}

/** Every kind of ref, so a new kind fails to compile until its row is written. */
const REF_KINDS: { [K in EntityRef["kind"]]: RefKind<RefOf<K>> } = {
  galaxy: mapOnly(() => "galaxy"),
  selection: mapOnly(() => "selection"),
  bodies: inSystem((ref) => `bodies:${ref.system}`, nothing, "overview"),
  lane: {
    key: (ref) => `lane:${ref.a}-${ref.b}`,
    addr: nothing,
    tabs: "overview",
    renumber: (ref, pairs) => renumberedLane(pairs, ref),
    home: (ref) => ({ systems: [ref.a, ref.b] }),
  },
  nebula: mapOnly((ref) => `nebula:${ref.index}`),
  system: {
    key: byId,
    addr: addrOf,
    tabs: "system",
    renumber(ref, pairs) {
      const next = renumberedId(pairs, ref.id);
      return next === null ? null : next === ref.id ? ref : { ...ref, id: next };
    },
    home: (ref) => ({ systems: [ref.id] }),
  },
  planet: entity((ref) => ({ listedIn: "planets", id: ref.id })),
  colony: entity(),
  fleet: entity((ref) => ({ listedIn: "fleets_present", id: ref.id })),
  ship: entity(),
  starbase: inSystem<RefOf<"starbase">>(byId, addrOf, "entity"),
  megastructure: entity((ref) => ({ listedIn: "megastructures", id: ref.id })),
  country: entity(),
  pop_group: entity(),
  sector: entity(),
  deposit: entity(),
  wormhole: inSystem<RefOf<"wormhole">>(byId, addrOf, "wormhole"),
  body: inSystem((ref) => `body:${ref.system}:${ref.id}`, nothing, "overview"),
  nodelist: {
    key: (ref) => `nodelist:${ref.parent.kind}:${ref.parent.id}/${ref.path.join("/")}`,
    addr: (ref) => ref.parent,
    tabs: "data",
    renumber(ref, pairs) {
      if (ref.parent.kind !== "system") return ref;
      const parent = renumberedId(pairs, ref.parent.id);
      if (parent === null) return null;
      return parent === ref.parent.id ? ref : { ...ref, parent: { ...ref.parent, id: parent } };
    },
    home: nothing,
  },
};

/** The row for `ref`'s kind, typed for `ref`. */
function kindOf<R extends EntityRef>(ref: R): RefKind<R> {
  return REF_KINDS[ref.kind] as unknown as RefKind<R>;
}

export function refKey(ref: EntityRef): string {
  return kindOf(ref).key(ref);
}

/** The entity a ref reads from, or null for what the map alone knows about. */
export function entityAddr(ref: EntityRef): EntityAddr | null {
  return kindOf(ref).addr(ref);
}

/** Where `ref`'s page lives, as an edit asks whether it touched it. */
export function refHome(ref: EntityRef): RefHome {
  return kindOf(ref).home(ref);
}

/**
 * What a drill onto `addr` opens. A station or a wormhole carries the system it stands in, so a
 * link with no system to give it stays where it is.
 */
export function refFor(addr: EntityAddr, system: number | null): EntityRef | null {
  if (addr.kind !== "starbase" && addr.kind !== "wormhole") return { kind: addr.kind, id: addr.id };
  return system === null ? null : { kind: addr.kind, system, id: addr.id };
}

/**
 * The page a body in the system view opens: its planet where the document has planets of its
 * own, else the body its initializer rolls.
 */
export function bodyEntry(system: number, id: number, label: string): Entry {
  return bodyEntryOf(
    !documentCapabilities(useFileSessionStore.getState()).rolled_layout,
    system,
    id,
    label,
  );
}

/** The same, where `planets` says whether the document has planets of its own. */
export function bodyEntryOf(planets: boolean, system: number, id: number, label: string): Entry {
  return { ref: planets ? { kind: "planet", id } : { kind: "body", system, id }, label };
}

/** What the open document lets a system's strip offer beyond the tabs every system has. */
export interface SystemTabs {
  /** The scripts that reach the system: a scenario with the game data loaded has them. */
  scripts: boolean;
  /** The field table: a save's system is one, a scenario's is the handful of statements above. */
  data: boolean;
}

/**
 * The tabs an entity offers, in order; a kind whose entity lists nothing drops Contents, and
 * what a system offers beyond that is the open document's to say.
 */
export function tabsFor(
  ref: EntityRef,
  hasContents = true,
  system: SystemTabs = { scripts: true, data: true },
): InspectorTab[] {
  switch (kindOf(ref).tabs) {
    case "system": {
      const tabs: InspectorTab[] = ["overview"];
      if (system.scripts) tabs.push("scripts");
      tabs.push("contents", "lanes");
      if (system.data) tabs.push("data");
      tabs.push("source");
      return tabs;
    }
    case "overview":
      return ["overview"];
    case "data":
      return ["data"];
    case "wormhole":
      return ["overview", "data", "source"];
    case "entity":
      return hasContents
        ? ["overview", "contents", "data", "source"]
        : ["overview", "data", "source"];
  }
}

/** `ref` with the system ids it names moved as `pairs` move them; null when its system is gone. */
export function renumberedRef(ref: EntityRef, pairs: Renumbering): EntityRef | null {
  return kindOf(ref).renumber(ref, pairs);
}

export interface InspectorState {
  /** Never empty; `stack[0]` is what the map selection decided, the rest are drill-downs. */
  stack: Entry[];
  tab: InspectorTab;
  /** Sections the user has opened or closed by hand, by key; the rest use their own default. */
  sections: Record<string, boolean>;
  /** Follows the map selection: a different entity restarts the stack, the same one leaves it alone. */
  setRoot(entry: Entry): void;
  /**
   * Follows an edit that renumbered systems: every page on a moved system names its new id, and
   * a page on a removed one, or on a planet it held, closes with everything opened from it.
   */
  renumber(pairs: Renumbering, removedPlanets?: ReadonlySet<number>): void;
  /** Drills into a child of the entity on top of the stack. */
  open(entry: Entry): void;
  /**
   * Opens an entity's page from outside the inspector: on its Overview, straight above the map's
   * root, with the dock turned to the inspector.
   */
  openPage(entry: Entry): void;
  /**
   * Opens a page clicked in the system view: straight above the map's root, so clicks never pile
   * up crumbs, with the dock turned to the inspector as a selection turns it.
   */
  openFromMap(entry: Entry): void;
  /** Closes every page on a scenario body, or on one in `systems`, with everything opened from it. */
  dropBodies(systems?: readonly number[]): void;
  /** Closes every page on one of `planets` or `colonies`, with everything opened from it. */
  dropPlanets(planets: readonly number[], colonies: readonly number[]): void;
  /**
   * The Galaxy crumb: pops a stack that stands on the galaxy back to it, and says so. A stack
   * rooted on a selection says false, and clearing the selection restarts it instead.
   */
  home(): boolean;
  /** Pops one crumb, turning the dock back to the tab the page came from, if another. */
  back(): void;
  /** The dock tab Back leaves the reader on. */
  backTo(): DockTab;
  /**
   * What Esc does first: pops one crumb, and says so. With nothing to pop, or with the dock
   * showing anything but the inspector, it says false and Esc clears the selection instead.
   */
  escape(): boolean;
  /** Goes back to the crumb at `depth`, dropping everything below it. */
  popTo(depth: number): void;
  setTab(tab: InspectorTab): void;
  toggleSection(key: string, fallback: boolean): void;
  /** Drops the user's choice for each of `keys`, so those sections take their default again. */
  resetSections(keys: readonly string[]): void;
  collapsed(key: string, fallback: boolean): boolean;
}

const SECTIONS = prefField<Record<string, boolean>>(
  PREF_KEYS.inspectorSections,
  {},
  isBooleanRecord,
);

/** The page a wormhole in system `system` opens, named as its plate is. */
export function wormholeEntry(system: number, id: number, label: string): Entry {
  return { ref: { kind: "wormhole", system, id }, label };
}

/** What a system's strip offers on a document with `capabilities`: its scripts while game data is loaded, and its field table. */
export function systemTabsOf(capabilities: Capabilities, gameDataReady: boolean): SystemTabs {
  return { scripts: capabilities.scripts && gameDataReady, data: capabilities.details };
}

function systemTabsNow(): SystemTabs {
  return systemTabsOf(
    documentCapabilities(useFileSessionStore.getState()),
    useGameDataStore.getState().status === "ready",
  );
}

/** The tab to show for `ref`: the current one when the entity offers it, else its first. */
function tabFor(ref: EntityRef, tab: InspectorTab): InspectorTab {
  const tabs = tabsFor(ref, true, systemTabsNow());
  return tabs.includes(tab) ? tab : tabs[0];
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
  stack: [GALAXY_ENTRY],
  tab: "overview",
  sections: SECTIONS.read(),

  setRoot(entry) {
    const { stack, tab } = get();
    if (refKey(stack[0].ref) === refKey(entry.ref)) {
      if (stack[0].label !== entry.label) set({ stack: [entry, ...stack.slice(1)] });
      return;
    }
    set({ stack: [entry], tab: tabFor(entry.ref, tab) });
  },

  renumber(pairs, removedPlanets = new Set()) {
    const { stack, tab } = get();
    const next: Entry[] = [];
    for (const entry of stack) {
      const ref = renumberedRef(entry.ref, pairs);
      if (ref === null || (ref.kind === "planet" && removedPlanets.has(ref.id))) break;
      next.push(ref === entry.ref ? entry : { ...entry, ref });
    }
    if (next.length === 0) next.push(GALAXY_ENTRY);
    if (next.length === stack.length && next.every((entry, i) => entry === stack[i])) return;
    set({ stack: next, tab: tabFor(next[next.length - 1].ref, tab) });
  },

  open(entry) {
    const { stack, tab } = get();
    const top = stack[stack.length - 1];
    if (refKey(top.ref) === refKey(entry.ref)) return;
    set({ stack: [...stack, entry], tab: tabFor(entry.ref, tab) });
  },

  openPage(entry) {
    const root = get().stack[0];
    const from = useLayoutStore.getState().tab;
    const page = from === "inspector" ? entry : { ...entry, from };
    const stack = refKey(root.ref) === refKey(entry.ref) ? [root] : [root, page];
    set({ stack, tab: tabsFor(entry.ref)[0] });
    useLayoutStore.getState().showInspector();
  },

  openFromMap(entry) {
    const { stack, tab } = get();
    const root = stack[0];
    const next = refKey(root.ref) === refKey(entry.ref) ? [root] : [root, entry];
    set({ stack: next, tab: tabFor(entry.ref, tab) });
    useLayoutStore.getState().revealInspector();
  },

  dropBodies(systems) {
    const { stack, tab } = get();
    const at = stack.findIndex(
      ({ ref }) => ref.kind === "body" && (systems === undefined || systems.includes(ref.system)),
    );
    if (at < 0) return;
    const next = at === 0 ? [GALAXY_ENTRY] : stack.slice(0, at);
    set({ stack: next, tab: tabFor(next[next.length - 1].ref, tab) });
  },

  dropPlanets(planets, colonies) {
    const { stack, tab } = get();
    const at = stack.findIndex(
      ({ ref }) =>
        (ref.kind === "planet" && planets.includes(ref.id)) ||
        (ref.kind === "colony" && colonies.includes(ref.id)),
    );
    if (at < 0) return;
    const next = at === 0 ? [GALAXY_ENTRY] : stack.slice(0, at);
    set({ stack: next, tab: tabFor(next[next.length - 1].ref, tab) });
  },

  home() {
    if (get().stack[0].ref.kind !== "galaxy") return false;
    get().popTo(0);
    return true;
  },

  back() {
    const to = get().backTo();
    get().popTo(get().stack.length - 2);
    if (to !== "inspector") useLayoutStore.getState().setTab(to);
  },

  backTo() {
    const { stack } = get();
    return stack[stack.length - 1].from ?? "inspector";
  },

  escape() {
    const layout = useLayoutStore.getState();
    if (layout.collapsed || layout.tab !== "inspector") return false;
    if (get().stack.length < 2) return false;
    get().back();
    return true;
  },

  popTo(depth) {
    const { stack, tab } = get();
    if (depth < 0 || depth >= stack.length - 1) return;
    const next = stack.slice(0, depth + 1);
    set({ stack: next, tab: tabFor(next[depth].ref, tab) });
  },

  setTab(tab) {
    set({ tab });
  },

  toggleSection(key, fallback) {
    const sections = { ...get().sections, [key]: !get().collapsed(key, fallback) };
    set({ sections });
    SECTIONS.save(sections);
  },

  resetSections(keys) {
    const sections = { ...get().sections };
    let dropped = false;
    for (const key of keys) {
      if (key in sections) {
        delete sections[key];
        dropped = true;
      }
    }
    if (!dropped) return;
    set({ sections });
    SECTIONS.save(sections);
  },

  collapsed(key, fallback) {
    return get().sections[key] ?? fallback;
  },
}));
