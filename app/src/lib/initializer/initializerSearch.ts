import type { InitializerView } from "../../generated/InitializerView";
import { type ModRef } from "./initializerGroups";
import { fileName, isUnder, normalise } from "../paths";

/** One initializer reduced to the lowercase text the browser's filter matches against. */
export interface SearchEntry {
  entry: InitializerView;
  /** Input order, so ties keep the order the caller supplied. */
  order: number;
  /** `entry.name`, lowercase: what a key prefix or substring is ranked on. */
  key: string;
  /** Every searchable field of the entry joined, lowercase. */
  haystack: string;
  usage: string;
  /** The mod's name and the file it is written in, or the bare file name for the base game. */
  source: string;
  /** The star class as the file writes it and as the game localises it. */
  starClass: string;
  flags: string;
  planets: number;
}

/** The mod whose folder holds the file, the deepest one when several nest. */
function owningMod(source: string, mods: readonly ModRef[]): ModRef | null {
  let owner: ModRef | null = null;
  let depth = 0;
  for (const mod of mods) {
    const base = normalise(mod.path);
    if (!isUnder(source, base) || base.length < depth) continue;
    owner = mod;
    depth = base.length;
  }
  return owner;
}

/**
 * Where the entry comes from: the mod that holds it and the file it is written in. The folders
 * between them are left out: `solar_system_initializers` would match half the words a user types.
 */
function sourceLabel(entry: InitializerView, mods: readonly ModRef[]): string {
  const mod = owningMod(entry.source, mods);
  const file = fileName(entry.source);
  return mod === null ? file : `${mod.name} ${file}`;
}

/** The localisation key of the initializer's own name, which the star body carries when it has one. */
function nameKey(entry: InitializerView): string | null {
  return entry.planets[0]?.name ?? null;
}

function localised(key: string | null, names: ReadonlyMap<string, string>): string {
  if (key === null || key === "") return "";
  return names.get(key) ?? "";
}

/**
 * One lowercase haystack per initializer, built once so filtering a few hundred entries on every
 * keystroke only scans strings.
 */
export function buildIndex(
  list: readonly InitializerView[],
  mods: readonly ModRef[],
  names: ReadonlyMap<string, string>,
): SearchEntry[] {
  return list.map((entry, order) => {
    const key = entry.name.toLowerCase();
    const label = (localised(nameKey(entry), names) || entry.name).toLowerCase();
    const raw = entry.class ?? "";
    const starClass = `${raw} ${localised(raw, names)}`.trim().toLowerCase();
    const usage = (entry.usage ?? "").toLowerCase();
    const source = sourceLabel(entry, mods).toLowerCase();
    const flags = entry.flags.join(" ").toLowerCase();
    const countries = entry.countries
      .map((c) => c.name_key)
      .join(" ")
      .toLowerCase();
    return {
      entry,
      order,
      key,
      haystack: `${key} ${label} ${starClass} ${usage} ${source} ${flags} ${countries}`,
      usage,
      source,
      starClass,
      flags,
      planets: entry.planet_count,
    };
  });
}

type FieldName = "usage" | "mod" | "class" | "flag";

const FIELDS: Record<FieldName, (e: SearchEntry) => string> = {
  usage: (e) => e.usage,
  mod: (e) => e.source,
  class: (e) => e.starClass,
  flag: (e) => e.flags,
};

export type Term =
  | { kind: "text"; text: string }
  | { kind: "field"; field: FieldName; text: string }
  | { kind: "planets"; op: ">" | "<" | "="; count: number };

function planetsTerm(value: string): Term | null {
  const op = value.startsWith(">") ? ">" : value.startsWith("<") ? "<" : "=";
  const count = Number(op === "=" ? value : value.slice(1));
  if (!Number.isFinite(count)) return null;
  return { kind: "planets", op, count };
}

function parseTerm(token: string): Term | null {
  const colon = token.indexOf(":");
  if (colon > 0) {
    const field = token.slice(0, colon);
    const value = token.slice(colon + 1);
    if (field === "planets") return value === "" ? null : planetsTerm(value);
    if (field in FIELDS && value !== "") {
      return { kind: "field", field: field as FieldName, text: value };
    }
  }
  return { kind: "text", text: token };
}

/** The words and field terms of a query; every one of them has to match. */
export function parseTerms(query: string): Term[] {
  const terms: Term[] = [];
  for (const token of query.toLowerCase().split(/\s+/)) {
    if (token === "") continue;
    const term = parseTerm(token);
    if (term !== null) terms.push(term);
  }
  return terms;
}

function matches(entry: SearchEntry, term: Term): boolean {
  if (term.kind === "text") return entry.haystack.includes(term.text);
  if (term.kind === "field") return FIELDS[term.field](entry).includes(term.text);
  if (term.op === ">") return entry.planets > term.count;
  if (term.op === "<") return entry.planets < term.count;
  return entry.planets === term.count;
}

/** 0 for a key the query opens, 1 for a key it appears inside, 2 for a hit on any other field. */
function rank(entry: SearchEntry, terms: readonly Term[]): number {
  let best = 2;
  for (const term of terms) {
    if (term.kind !== "text") continue;
    if (entry.key.startsWith(term.text)) return 0;
    if (entry.key.includes(term.text)) best = 1;
  }
  return best;
}

/**
 * Every entry whose haystack satisfies all of the query's terms, key matches first and input
 * order within each rank. An empty query is every entry, unranked.
 */
export function search(
  index: readonly SearchEntry[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): InitializerView[] {
  const terms = parseTerms(query);
  if (terms.length === 0) return index.slice(0, limit).map((e) => e.entry);
  const buckets: InitializerView[][] = [[], [], []];
  for (const entry of index) {
    if (!terms.every((term) => matches(entry, term))) continue;
    buckets[rank(entry, terms)].push(entry.entry);
  }
  return buckets[0].concat(buckets[1], buckets[2]).slice(0, limit);
}
