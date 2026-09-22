import type { CountryNode } from "../generated/CountryNode";
import { issueTitle } from "./issueCopy";
import type { AppIssue, AppIssueCode } from "./issues";
import type { SpecialSystem } from "../generated/SpecialSystem";
import { badgeLabel, humaniseInitializer } from "./visual/specialStyle";
import {
  drawsBorders,
  isFauna,
  isMarauder,
  territoryKind,
  type CountryTypes,
} from "./countryKinds";
import { supersededCountry, systemsOf, type Ownership } from "./ownership";
import { kindLabel } from "./special";
import { titleCase } from "./text";

export { issueTitle };

/** What a row needs looking up; the caller decides where the answers come from. */
export interface RowLookups {
  countryName(country: CountryNode): string;
  systemName(id: number): string;
  /** The country's most central owned system: where to go when it has no capital. */
  centralSystem(ownerId: number): number | null;
}

export const EMPIRE_GROUPS = [
  "empire",
  "fallen",
  "awakened",
  "marauder",
  "caravaneer",
  "other",
] as const;

export type EmpireGroupKey = (typeof EMPIRE_GROUPS)[number];

const EMPIRE_GROUP_LABELS: Record<EmpireGroupKey, string> = {
  empire: "Empires",
  fallen: "Fallen empires",
  awakened: "Awakened empires",
  marauder: "Marauders",
  caravaneer: "Caravaneers",
  other: "Other",
};

export interface EmpireRow {
  /** The owner the row stands for: a country's id, or a marauder clan's negative one. */
  id: number;
  /** The country behind the row; a clan a scenario places has none. */
  country: CountryNode | null;
  /** File order, which the owners layer's palette follows. */
  index: number;
  name: string;
  /** The capital (or the middle of its territory) and how many systems it holds. */
  subline: string;
  systemCount: number;
  /** Where the name goes: the capital system, else the one nearest the middle of its territory. */
  capital: number | null;
}

export interface EmpireGroup {
  key: EmpireGroupKey;
  label: string;
  rows: EmpireRow[];
}

function isEnclave(country: CountryNode, types: CountryTypes): boolean {
  return types.get(country.country_type)?.is_enclave ?? country.country_type.includes("enclave");
}

/** Which group a country belongs in, most specific first; null for the enclaves, which the
 * Points of interest tab lists instead. */
export function empireGroup(country: CountryNode, types: CountryTypes): EmpireGroupKey | null {
  if (isMarauder(country)) return "marauder";
  if (territoryKind(country, types) === "fallen_empire") {
    return country.country_type.startsWith("awakened") ? "awakened" : "fallen";
  }
  if (country.country_type.startsWith("caravaneer")) return "caravaneer";
  if (isEnclave(country, types)) return null;
  return drawsBorders(country, types) ? "empire" : "other";
}

function subline(where: string, count: number): string {
  return `${where} · ${count} ${count === 1 ? "system" : "systems"}`;
}

function empireRow(country: CountryNode, index: number, lookups: RowLookups): EmpireRow {
  const capital = country.capital_system ?? lookups.centralSystem(country.id);
  const count = country.system_count;
  const where =
    country.capital_system === null ? "no capital" : lookups.systemName(country.capital_system);
  return {
    id: country.id,
    country,
    index,
    name: lookups.countryName(country),
    subline: subline(where, count),
    systemCount: count,
    capital,
  };
}

/** A marauder clan a scenario places: its row goes to the home and counts the clan's systems. */
function clanRows(ownership: Ownership, lookups: RowLookups): EmpireRow[] {
  const rows: EmpireRow[] = [];
  for (const entry of ownership.table.values()) {
    if (entry.kind !== "marauder_clan") continue;
    const home = entry.home ?? null;
    const count = systemsOf(ownership.owners, entry.id).length;
    rows.push({
      id: entry.id,
      country: null,
      index: 0,
      name: entry.label,
      subline: subline(home === null ? "no home" : lookups.systemName(home), count),
      systemCount: count,
      capital: home,
    });
  }
  return rows;
}

/** Every country but the space fauna and the enclaves, grouped by type, the biggest first
 * inside each group, and the marauder clans the composed ownership adds among the marauders. */
export function empireGroups(
  countries: ReadonlyMap<number, CountryNode>,
  types: CountryTypes,
  lookups: RowLookups,
  ownership: Ownership,
): EmpireGroup[] {
  const grouped = new Map<EmpireGroupKey, EmpireRow[]>();
  const add = (key: EmpireGroupKey, row: EmpireRow): void => {
    const rows = grouped.get(key);
    if (rows) rows.push(row);
    else grouped.set(key, [row]);
  };
  [...countries.values()].forEach((country, index) => {
    if (isFauna(country, types) || supersededCountry(ownership, country, types)) return;
    const key = empireGroup(country, types);
    if (key === null) return;
    add(key, empireRow(country, index, lookups));
  });
  for (const row of clanRows(ownership, lookups)) add("marauder", row);
  return EMPIRE_GROUPS.flatMap((key) => {
    const rows = grouped.get(key);
    if (rows === undefined) return [];
    rows.sort((a, b) => b.systemCount - a.systemCount || a.name.localeCompare(b.name));
    return [{ key, label: EMPIRE_GROUP_LABELS[key], rows }];
  });
}

/** Country id → the special system the save puts it in, for a country that holds none itself. */
export function specialSystemOfCountry(
  special: ReadonlyMap<number, SpecialSystem>,
): Map<number, number> {
  const where = new Map<number, number>();
  for (const system of special.values()) {
    for (const country of system.countries) {
      if (country.id !== null && !where.has(country.id)) where.set(country.id, system.id);
    }
  }
  return where;
}

/** The kinds the Points of interest tab lists: the country-shaped ones live in Empires. */
export const POINT_KINDS = ["leviathan", "enclave", "landmark", "unique"] as const;

export type PointKind = (typeof POINT_KINDS)[number];

const POINT_LABELS: Record<PointKind, string> = {
  leviathan: "Leviathans",
  enclave: "Enclaves",
  landmark: "Galactic landmarks",
  unique: "Scripted systems",
};

/** Kinds whose row reads as the system first, with what stands there as the subline. */
const NAME_FIRST: ReadonlySet<PointKind> = new Set(["landmark", "unique"]);

export interface PointRow {
  id: number;
  label: string;
  subline: string | null;
}

export interface PointGroup {
  /** Stable across launches: the collapse memory keys on it. */
  key: string;
  label: string;
  kind: PointKind;
  count: number;
  rows: PointRow[];
  /** Scripted systems split by the file defining the initializer; empty for every other kind. */
  groups: PointGroup[];
}

function pointRow(
  s: SpecialSystem,
  kind: PointKind,
  withGameData: boolean,
  names: ReadonlyMap<string, string>,
  systemName: (id: number) => string,
): PointRow {
  const name = systemName(s.id);
  if (kind === "unique") {
    const subline = s.initializer === "" ? null : humaniseInitializer(s.initializer);
    return { id: s.id, label: name, subline };
  }
  const labelled = withGameData ? s : { ...s, label: "" };
  const badge = badgeLabel(kind, labelled, name, names);
  if (badge === name || badge === kindLabel(kind)) return { id: s.id, label: name, subline: null };
  return NAME_FIRST.has(kind)
    ? { id: s.id, label: name, subline: badge }
    : { id: s.id, label: badge, subline: name };
}

/** `distant_stars_initializers.txt` becomes `Distant Stars`; the initializer's prefix without game data. */
function scriptedGroupOf(s: SpecialSystem): { key: string; label: string } {
  const file = s.source_file ?? "";
  if (file !== "") {
    const core = file
      .replace(/\.[a-z]+$/i, "")
      .replace(/^\d+_/, "")
      .replace(/_initializers?$/, "");
    return { key: file, label: humaniseInitializer(core) };
  }
  const prefix = s.initializer.split("_")[0];
  return prefix === ""
    ? { key: "prefix", label: "Other" }
    : { key: prefix, label: titleCase(prefix.split("_")) };
}

function scriptedGroups(entries: Array<{ s: SpecialSystem; row: PointRow }>): PointGroup[] {
  const groups = new Map<string, PointGroup>();
  for (const { s, row } of entries) {
    const { key, label } = scriptedGroupOf(s);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, kind: "unique", count: 0, rows: [], groups: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.count++;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Every point of interest, grouped by kind, with Scripted systems split by its source file. */
export function pointGroups(
  special: ReadonlyMap<number, SpecialSystem>,
  withGameData: boolean,
  names: ReadonlyMap<string, string>,
  systemName: (id: number) => string,
): PointGroup[] {
  const byKind = new Map<PointKind, Array<{ s: SpecialSystem; row: PointRow }>>();
  for (const s of special.values()) {
    const kind = POINT_KINDS.find((k) => k === s.primary);
    if (kind === undefined) continue;
    const entry = { s, row: pointRow(s, kind, withGameData, names, systemName) };
    const entries = byKind.get(kind);
    if (entries) entries.push(entry);
    else byKind.set(kind, [entry]);
  }
  return POINT_KINDS.flatMap((kind) => {
    const entries = byKind.get(kind);
    if (entries === undefined) return [];
    entries.sort((a, b) => a.row.label.localeCompare(b.row.label));
    const scripted = kind === "unique";
    return [
      {
        key: kind,
        label: POINT_LABELS[kind],
        kind,
        count: entries.length,
        rows: scripted ? [] : entries.map((e) => e.row),
        groups: scripted ? scriptedGroups(entries) : [],
      },
    ];
  });
}

export interface IssueRow {
  issue: AppIssue;
  /** The systems the issue names, on the row's own line. */
  systems: string;
}

export interface IssueGroup {
  code: AppIssueCode;
  title: string;
  /** An error anywhere in the group colours its header. */
  error: boolean;
  /** Whether the rows differ in severity, so each one needs a mark of its own. */
  mixed: boolean;
  rows: IssueRow[];
}

/** Issues grouped by code, errors first and the biggest group next, as the design sorts them. */
export function issueGroups(issues: AppIssue[], nameOf: (id: number) => string): IssueGroup[] {
  const groups = new Map<AppIssueCode, IssueGroup>();
  for (const issue of issues) {
    let group = groups.get(issue.code);
    if (!group) {
      group = {
        code: issue.code,
        title: issueTitle(issue.code),
        error: false,
        mixed: false,
        rows: [],
      };
      groups.set(issue.code, group);
    }
    group.error = group.error || issue.severity === "error";
    group.rows.push({ issue, systems: issue.systems.map(nameOf).join(", ") });
  }
  for (const group of groups.values()) {
    group.mixed = new Set(group.rows.map((row) => row.issue.severity)).size > 1;
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.error) - Number(a.error) ||
      b.rows.length - a.rows.length ||
      a.code.localeCompare(b.code),
  );
}
