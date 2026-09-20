import type { InitializerView } from "../../generated/InitializerView";
import type { SpawnedCountry } from "../../generated/SpawnedCountry";
import { isUnder, lastSegment, normalise } from "../paths";

/** One enabled mod: what to call it, and the folder its files live under. */
export interface ModRef {
  name: string;
  path: string;
}

/** The mods a game-data summary reports, less the ones with no folder on disk. */
export function modRefs(mods: ReadonlyArray<{ name: string; dir: string | null }>): ModRef[] {
  return mods.flatMap((mod) => (mod.dir === null ? [] : [{ name: mod.name, path: mod.dir }]));
}

export interface InitializerGroup {
  id: string;
  label: string;
  entries: InitializerView[];
}

export interface InitializerDescription {
  class: string | null;
  usage: string | null;
  flags: string[];
  maxInstances: number | null;
  countries: SpawnedCountry[];
  source: string;
}

/** Whether the initializer is one a country starts in, so it needs a `spawn_weight`. */
export function isEmpireSpawn(entry: InitializerView): boolean {
  return entry.empire_spawn;
}

export function describeInitializer(entry: InitializerView): InitializerDescription {
  return {
    class: entry.class,
    usage: entry.usage,
    flags: entry.flags,
    maxInstances: entry.max_instances,
    countries: entry.countries,
    source: entry.source,
  };
}

/** The defining file without its extension: `misc_system_initializers.txt` → `misc_system_initializers`. */
function fileStem(source: string): string {
  return lastSegment(source).replace(/\.[^.]*$/, "");
}

const MEGASTRUCTURE =
  /dyson|ring_world|megastructure|science_nexus|sentry|art_install|interstellar_assembly|matter_decompressor|mega_shipyard|strategic_coord/;

interface Category {
  id: string;
  label: string;
  match(entry: InitializerView, stem: string): boolean;
}

/** Tried in order; the first that matches owns the entry, so nothing appears twice. */
const CATEGORIES: Category[] = [
  { id: "empire", label: "Empire spawn", match: (entry) => isEmpireSpawn(entry) },
  {
    id: "fallen_empire",
    label: "Fallen empire",
    match: (entry, stem) =>
      entry.usage === "fallen_empire_init" || stem === "fallen_empire_initializers",
  },
  {
    id: "marauder",
    label: "Marauder",
    match: (entry, stem) => entry.usage === "nomad_init" || stem === "marauder_initializers",
  },
  { id: "origin", label: "Origin", match: (entry) => entry.usage === "origin" },
  { id: "leviathan", label: "Leviathans", match: (_, stem) => stem.startsWith("leviathans_") },
  { id: "hostile", label: "Hostile", match: (_, stem) => stem.startsWith("hostile_") },
  {
    id: "megastructure",
    label: "Megastructures",
    match: (entry) => MEGASTRUCTURE.test(entry.name.toLowerCase()),
  },
  {
    id: "unique",
    label: "Unique & special",
    match: (_, stem) =>
      stem.startsWith("unique_") ||
      stem.startsWith("special_") ||
      stem.startsWith("distant_stars_"),
  },
];

function stemLabel(stem: string): string {
  const base = stem
    .replace(/_?(solar_)?system_initializers$/, "")
    .replace(/_?initializers$/, "")
    .replace(/_/g, " ")
    .trim();
  if (base === "") return stem;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function modLabel(mod: ModRef): string {
  const name = mod.name.trim();
  return name === "" ? lastSegment(mod.path) : name;
}

function uniqueMods(mods: ModRef[]): ModRef[] {
  return mods.filter(
    (mod, i) =>
      mod.path !== "" &&
      mods.findIndex((other) => normalise(other.path) === normalise(mod.path)) === i,
  );
}

function append(groups: InitializerGroup[], id: string, label: string, entries: InitializerView[]) {
  if (entries.length === 0) return;
  groups.push({ id, label, entries: [...entries].sort((a, b) => a.name.localeCompare(b.name)) });
}

/**
 * Every initializer the loaded game data knows, in the order a picker offers them: the derived
 * categories, then one group per mod for the custom content they did not claim, then the
 * remaining vanilla files.
 */
export function groupInitializers(list: InitializerView[], mods: ModRef[]): InitializerGroup[] {
  const known = uniqueMods(mods);
  const byCategory = new Map(CATEGORIES.map((c) => [c.id, [] as InitializerView[]]));
  const byMod = new Map(known.map((mod) => [mod.path, [] as InitializerView[]]));
  const byStem = new Map<string, InitializerView[]>();

  for (const entry of list) {
    const stem = fileStem(entry.source);
    const category = CATEGORIES.find((c) => c.match(entry, stem));
    if (category) {
      byCategory.get(category.id)?.push(entry);
      continue;
    }
    const mod = known.find((m) => isUnder(entry.source, m.path));
    if (mod) {
      byMod.get(mod.path)?.push(entry);
      continue;
    }
    const bucket = byStem.get(stem);
    if (bucket) bucket.push(entry);
    else byStem.set(stem, [entry]);
  }

  const groups: InitializerGroup[] = [];
  for (const category of CATEGORIES) {
    append(groups, category.id, category.label, byCategory.get(category.id) ?? []);
  }
  for (const mod of known) {
    append(groups, `mod:${mod.path}`, modLabel(mod), byMod.get(mod.path) ?? []);
  }
  const stems = [...byStem.keys()]
    .map((stem) => ({ stem, label: stemLabel(stem) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const { stem, label } of stems) {
    append(groups, `file:${stem}`, label, byStem.get(stem) ?? []);
  }
  return groups;
}

/** The defining file as the install or the mod that holds it names it. */
export function relativeSource(source: string, roots: string[]): string {
  const path = source.replace(/\\/g, "/");
  let deepest = "";
  for (const root of roots) {
    if (isUnder(source, root) && normalise(root).length > deepest.length) deepest = normalise(root);
  }
  if (deepest === "") return path;
  return path.slice(deepest.length).replace(/^\/+/, "");
}
