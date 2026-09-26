import { create } from "zustand";
import type { EntityAddr } from "../generated/EntityAddr";
import type { DocumentKind } from "../generated/DocumentKind";
import type { EntityKind } from "../generated/EntityKind";
import { renumberedId, renumberedLane, type Renumbering } from "../lib/renumber";
import { useEditorStore } from "./editorStore";
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

/** What the inspector is looking at. The first four come from the map, the rest from a drill-down. */
export type EntityRef =
  | { kind: "galaxy" }
  | { kind: "selection" }
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

export function refKey(ref: EntityRef): string {
  switch (ref.kind) {
    case "galaxy":
    case "selection":
      return ref.kind;
    case "lane":
      return `lane:${ref.a}-${ref.b}`;
    case "nebula":
      return `nebula:${ref.index}`;
    case "body":
      return `body:${ref.system}:${ref.id}`;
    case "nodelist":
      return `nodelist:${ref.parent.kind}:${ref.parent.id}/${ref.path.join("/")}`;
    default:
      return `${ref.kind}:${ref.id}`;
  }
}

/** The entity a ref reads from, or null for what the map alone knows about. */
export function entityAddr(ref: EntityRef): EntityAddr | null {
  switch (ref.kind) {
    case "galaxy":
    case "selection":
    case "lane":
    case "nebula":
    case "body":
      return null;
    case "nodelist":
      return ref.parent;
    default:
      return { kind: ref.kind, id: ref.id };
  }
}

/**
 * What a drill onto `addr` opens. A station carries the system it stands in, so a link with
 * no system to give it stays where it is.
 */
export function refFor(addr: EntityAddr, system: number | null): EntityRef | null {
  if (addr.kind !== "starbase") return { kind: addr.kind, id: addr.id };
  return system === null ? null : { kind: "starbase", system, id: addr.id };
}

/** The page a body in the system view opens: a save's planet, or a scenario's body. */
export function bodyEntry(system: number, id: number, label: string): Entry {
  const scenario = useFileSessionStore.getState().kind === "scenario";
  return { ref: scenario ? { kind: "body", system, id } : { kind: "planet", id }, label };
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
  switch (ref.kind) {
    case "system": {
      const tabs: InspectorTab[] = ["overview"];
      if (system.scripts) tabs.push("scripts");
      tabs.push("contents", "lanes");
      if (system.data) tabs.push("data");
      tabs.push("source");
      return tabs;
    }
    case "galaxy":
    case "selection":
    case "lane":
    case "nebula":
    case "body":
      return ["overview"];
    case "nodelist":
      return ["data"];
    default:
      return hasContents
        ? ["overview", "contents", "data", "source"]
        : ["overview", "data", "source"];
  }
}

/** `ref` with the system ids it names moved as `pairs` move them; null when its system is gone. */
export function renumberedRef(ref: EntityRef, pairs: Renumbering): EntityRef | null {
  const id = (n: number) => renumberedId(pairs, n);
  switch (ref.kind) {
    case "system": {
      const next = id(ref.id);
      return next === null ? null : next === ref.id ? ref : { ...ref, id: next };
    }
    case "lane":
      return renumberedLane(pairs, ref);
    case "starbase":
    case "body": {
      const system = id(ref.system);
      return system === null ? null : system === ref.system ? ref : { ...ref, system };
    }
    case "nodelist": {
      if (ref.parent.kind !== "system") return ref;
      const parent = id(ref.parent.id);
      if (parent === null) return null;
      return parent === ref.parent.id ? ref : { ...ref, parent: { ...ref.parent, id: parent } };
    }
    default:
      return ref;
  }
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
  /**
   * Goes to system `id`'s page, back down the stack when the page is on it, else by selecting
   * the system, and eases the map to it either way.
   */
  openSystem(id: number): void;
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

/** What a system's strip offers on a document of `kind`: scripts on a scenario with game data, data on a save. */
export function systemTabsOf(kind: DocumentKind | null, gameDataReady: boolean): SystemTabs {
  const scenario = kind === "scenario";
  return { scripts: scenario && gameDataReady, data: !scenario };
}

function systemTabsNow(): SystemTabs {
  return systemTabsOf(
    useFileSessionStore.getState().kind,
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

  openSystem(id) {
    const key = refKey({ kind: "system", id });
    const at = get().stack.findIndex((entry) => refKey(entry.ref) === key);
    if (at < 0) {
      void useEditorStore.getState().jumpTo(id);
      return;
    }
    get().popTo(at);
    useEditorStore.getState().focusOn(id);
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
