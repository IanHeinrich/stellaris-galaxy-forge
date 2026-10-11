/**
 * Where a body's page reads its body, one source per document kind. Every kind gives the summary
 * and layout its system's details list; each source adds the rows the page lists, what each row
 * gives back to remove it, the adapter that edits the body, and the save's own read for the
 * sections only a save has.
 */
import { useMemo } from "react";
import type { DepositTypeView } from "../../../generated/DepositTypeView";
import type { DocumentKind } from "../../../generated/DocumentKind";
import type { ModifierView } from "../../../generated/ModifierView";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PlanetPageDigSite } from "../../../generated/PlanetPageDigSite";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import {
  addWarnings,
  removalTarget,
  removalWarnings,
  TERRAFORMING_NOTE,
  warningNameKeys,
} from "../../../lib/details/depositWarnings";
import type { HeldAnomaly, PickerTarget, RowRefs } from "../../../lib/details/picker";
import {
  depositGroups,
  modifierRows,
  planetDataKeys,
  type DepositGroup,
  type ModifierRow,
} from "../../../lib/details/planetPage";
import type { Names } from "../../../lib/names";
import { statedModifierKeys, statedModifierRows } from "../../../lib/details/spawnFacts";
import { useGameDataStore } from "../../../store/gameDataStore";
import {
  bodyPickerTarget,
  heldAnomaly,
  planetEditAdapterFor,
  savePickerTarget,
} from "../../../store/planetEditAdapter";
import { usePlanetDataStore, type PlanetDataKeys } from "../../../store/planetDataStore";
import { usePlanetPage } from "./useEntity";

/** Deposits of one type hiding the same feature, and how the page takes one of them off. */
export interface HeldDeposit extends DepositGroup {
  /** The deposit a remove takes off and what the game takes away with it; `null` where none can go. */
  removal: { ref: RowRefs["deposit"]; warnings: readonly string[] } | null;
}

/** A body's deposits as the Deposits section lists them. */
export interface HeldDeposits {
  count: number;
  features: HeldDeposit[];
  blockers: HeldDeposit[];
  /** What the game takes away for an add of type `key`, to confirm first. */
  addWarnings(key: string): readonly string[];
  /** The keys the warnings name. */
  nameKeys: readonly string[];
  /** The station that works its extractable deposits. */
  station: number | null;
  /** What the section says above the rows it edits. */
  notes: readonly string[];
}

export interface HeldModifier {
  row: ModifierRow;
  ref: RowRefs["modifier"];
}

export interface HeldDigSite {
  site: PlanetPageDigSite;
  ref: RowRefs["digSite"];
}

/** What a body's page lists, each row with what it gives back to its source's adapter. */
export interface BodyRows {
  deposits: HeldDeposits;
  modifiers: HeldModifier[];
  anomaly: HeldAnomaly | null;
  digSite: HeldDigSite | null;
}

/** One body as its page reads it. */
export interface BodyRead {
  details: SystemDetails;
  summary: PlanetSummary;
  /** The body its page says it orbits; `null` for one about the system's centre. */
  parent: number | null;
  rows: BodyRows;
  target: PickerTarget;
  /** The game data keys the page shows. */
  dataKeys: PlanetDataKeys;
  /** A save's own read of the body, for its colony, survey, controller and flags; `null` elsewhere. */
  page: PlanetPage | null;
  /**
   * Its system's details list it. A save body they can't list is drawn from its own read, without
   * what only they say: its star's fields, its ring and its orbit.
   */
  listed: boolean;
  /** Its orbit radius has a row of its own; else About gives it beside what the body orbits. */
  orbitRow: boolean;
}

/**
 * The body in its system's details, or what the page says while they are read; `settled` once
 * reading again won't list it: the read failed, or the details don't list the body.
 */
export type Listed =
  { details: SystemDetails; summary: PlanetSummary } | { waiting: string; settled: boolean };

/** A source's answer: the body, the line to show while it waits, or the generic entity view. */
export type BodyAnswer = { read: BodyRead } | { waiting: string } | { generic: true };

export interface BodySource {
  /** Body `id` of system `system` as `listed` has it, with what the source adds. */
  useRead(system: number, id: number, listed: Listed): BodyAnswer;
  /** Its Data and Source tabs are the generic entity view, which reads the body by its id. */
  entityTabs: boolean;
}

export const READING_PLANET = "Reading the planet…";

const NO_DEPOSITS: Omit<HeldDeposits, "count" | "features" | "blockers"> = {
  addWarnings: () => [],
  nameKeys: [],
  station: null,
  notes: [],
};

/** A save body's rows, read from its page. */
function saveRows(
  page: PlanetPage,
  anomaly: HeldAnomaly | null,
  views: ReadonlyMap<string, DepositTypeView>,
  modifiers: ReadonlyMap<string, ModifierView>,
  names: Names,
): BodyRows {
  const { features, blockers } = depositGroups(page.deposits, views);
  const held = (group: DepositGroup): HeldDeposit => {
    const deposit = removalTarget(page, group.kind, group.swapType);
    const removal = deposit && {
      ref: deposit,
      warnings: removalWarnings(page, deposit, views, names),
    };
    return { ...group, removal };
  };
  const site = page.dig_site;
  return {
    deposits: {
      count: page.deposits.length,
      features: features.map(held),
      blockers: blockers.map(held),
      addWarnings: (key) => addWarnings(page, key, views, names),
      nameKeys: warningNameKeys(page),
      station: page.station,
      notes: page.terraforming ? [TERRAFORMING_NOTE] : [],
    },
    modifiers: modifierRows(page, modifiers).map((row) => ({ row, ref: row })),
    anomaly,
    digSite: site && { site, ref: site.id },
  };
}

function saveDataKeys(page: PlanetPage): PlanetDataKeys {
  return {
    ...planetDataKeys(page),
    anomalies: page.anomaly === null ? [] : [page.anomaly.category],
    digSites: page.dig_site === null ? [] : [page.dig_site.kind],
  };
}

/** A body a save's own read names, where no details list it: its id, name, class and size. */
function pageBody(
  body: Pick<PlanetPage, "id" | "name" | "name_key" | "class" | "size">,
  parent: number | null,
): PlanetSummary {
  const moon = parent !== null;
  return {
    id: body.id,
    class: body.class,
    name: body.name,
    name_key: body.name_key,
    colonised: false,
    capital: false,
    habitable: null,
    owner: null,
    moon,
    role: moon ? "moon" : "planet",
    pre_ftl: false,
    size: body.size,
    orbit: null,
    deposits: [],
    deposit_keys: [],
    pops: 0,
    parent,
    layout: null,
    ring: null,
  };
}

/** Save body `page` and its moons in system `system`, as its own read gives them. */
function pageListing(page: PlanetPage, system: number) {
  const summary: PlanetSummary = {
    ...pageBody(page, null),
    colonised: page.colony !== null,
    owner: page.owner,
    orbit: page.orbit,
    pops: page.colony?.pops ?? 0,
    ...(page.entity_name === null ? {} : { entity_name: page.entity_name }),
    ...(page.anomaly === null ? {} : { anomaly: page.anomaly.category }),
  };
  const details: SystemDetails = {
    id: system,
    resources: [],
    planets: [summary, ...page.moons.map((moon) => pageBody(moon, page.id))],
    starbase: null,
    fleets: { fleet_count: 0, military_count: 0, ship_count: 0, military_power: 0 },
    fleets_present: [],
    megastructures: [],
    sites: [],
    with_game_data: false,
    belts: [],
    inner_radius: null,
    wormholes: [],
  };
  return { details, summary };
}

function useSaveRead(system: number, id: number, listed: Listed): BodyAnswer {
  const { value: page, error } = usePlanetPage(id);
  const views = usePlanetDataStore((s) => s.depositTypes);
  const modifiers = usePlanetDataStore((s) => s.modifiers);
  const names = useGameDataStore((s) => s.names);
  const own = useMemo(() => {
    if (page === undefined) return null;
    if (!("waiting" in listed)) return { ...listed, listed: true };
    return listed.settled ? { ...pageListing(page, page.system ?? system), listed: false } : null;
  }, [page, listed, system]);
  const anomaly = useMemo(() => (page === undefined ? null : heldAnomaly(page)), [page]);
  const target = useMemo(
    () =>
      page === undefined || own === null
        ? null
        : savePickerTarget(own.details.id, own.summary, page, anomaly),
    [page, own, anomaly],
  );
  const rows = useMemo(
    () => (page === undefined ? null : saveRows(page, anomaly, views, modifiers, names)),
    [page, anomaly, views, modifiers, names],
  );
  const dataKeys = useMemo(() => (page === undefined ? null : saveDataKeys(page)), [page]);
  if (error !== undefined) return { generic: true };
  if (page === undefined || rows === null || dataKeys === null) return { waiting: READING_PLANET };
  if (own === null || target === null) {
    return { waiting: "waiting" in listed ? listed.waiting : READING_PLANET };
  }
  return {
    read: {
      details: own.details,
      summary: own.summary,
      parent: page.parent,
      rows,
      target,
      dataKeys,
      page,
      listed: own.listed,
      orbitRow: false,
    },
  };
}

/** One deposit entry per deposit the summary counts, as `depositGroups` groups them. */
function summaryDeposits(summary: PlanetSummary) {
  return summary.deposit_keys.flatMap(({ key, count }) =>
    Array.from({ length: count }, (_, id) => ({ id, kind: key, swap_type: null })),
  );
}

/**
 * A body read from its summary alone: its rows list, with the modifiers a scenario's initializer
 * states, and nothing can be removed.
 */
function summaryRows(
  summary: PlanetSummary,
  views: ReadonlyMap<string, DepositTypeView>,
  modifiers: ReadonlyMap<string, ModifierView>,
): BodyRows {
  const { features, blockers } = depositGroups(summaryDeposits(summary), views);
  const held = (group: DepositGroup): HeldDeposit => ({ ...group, removal: null });
  return {
    deposits: {
      ...NO_DEPOSITS,
      count: summary.deposit_keys.reduce((n, d) => n + d.count, 0),
      features: features.map(held),
      blockers: blockers.map(held),
    },
    modifiers: (summary.spawn === undefined
      ? []
      : statedModifierRows(summary.spawn.features, modifiers)
    ).map((row) => ({ row, ref: row })),
    anomaly: summaryHeld(summary).anomaly,
    digSite: null,
  };
}

function summaryDataKeys(summary: PlanetSummary): PlanetDataKeys {
  return {
    deposits: summary.deposit_keys.map((d) => d.key),
    modifiers: summary.spawn === undefined ? [] : statedModifierKeys(summary.spawn.features),
    colonyTypes: [],
    anomalies: [
      ...(summary.anomaly === undefined ? [] : [summary.anomaly]),
      ...(summary.spawn?.anomalies.categories ?? []),
    ],
    digSites: [],
  };
}

/** What a body read from its summary holds that its pickers read. */
function summaryHeld(summary: PlanetSummary) {
  const anomaly = summary.anomaly;
  return {
    deposits: summaryDeposits(summary).map((d) => d.kind),
    modifiers: [],
    anomaly: anomaly === undefined ? null : { category: anomaly, foundBy: null },
  };
}

function useScenarioRead(system: number, id: number, listed: Listed): BodyAnswer {
  const views = usePlanetDataStore((s) => s.depositTypes);
  const modifiers = usePlanetDataStore((s) => s.modifiers);
  const summary = "waiting" in listed ? undefined : listed.summary;
  const target = useMemo(() => {
    if (summary === undefined) return null;
    const edits = planetEditAdapterFor("scenario", { system, id });
    return bodyPickerTarget("scenario", system, summary, summaryHeld(summary), edits);
  }, [system, summary, id]);
  const rows = useMemo(
    () => (summary === undefined ? null : summaryRows(summary, views, modifiers)),
    [summary, views, modifiers],
  );
  const dataKeys = useMemo(
    () => (summary === undefined ? null : summaryDataKeys(summary)),
    [summary],
  );
  if ("waiting" in listed) return { waiting: listed.waiting };
  if (target === null || rows === null || dataKeys === null) return { waiting: READING_PLANET };
  return {
    read: {
      details: listed.details,
      summary: listed.summary,
      parent: listed.summary.parent,
      rows,
      target,
      dataKeys,
      page: null,
      listed: true,
      orbitRow: true,
    },
  };
}

/** Each kind's source for a body. A new kind fails to compile until its row is written. */
export const BODY_SOURCES: Readonly<Record<DocumentKind, BodySource>> = {
  save: { useRead: useSaveRead, entityTabs: true },
  scenario: { useRead: useScenarioRead, entityTabs: false },
};
