/**
 * How a body's page and menus edit it, whatever the document is: its fields, its removal, and its
 * deposits, modifiers, dig site and anomaly. `planetEditAdapterFor` is the one place a source is
 * chosen, and the save's ops are built here, as are those of `bodiesEdits`, which edits several
 * selected save bodies at once.
 */
import type { DocumentKind } from "../generated/DocumentKind";
import type { ModifierView } from "../generated/ModifierView";
import type { Op } from "../generated/Op";
import type { PlanetPage } from "../generated/PlanetPage";
import type { PlanetPageDeposit } from "../generated/PlanetPageDeposit";
import type { PlanetSummary } from "../generated/PlanetSummary";
import type {
  HeldAnomaly,
  PickerTarget,
  PlanetBody,
  PlanetEditAdapter,
  RowRefs,
} from "../lib/details/picker";
import type { ModifierRow } from "../lib/details/planetPage";
import {
  planAddDeposit,
  planAddModifier,
  planClass,
  planFillDeposit,
  planRemoveDeposit,
  planRemoveModifier,
  planRing,
  planSize,
  pickOf,
  type BodiesPlan,
  type SelectedBody,
} from "../lib/details/bodiesEdit";
import { classRule } from "../lib/details/planetClass";
import { DEFAULT_MODEL } from "../lib/details/planetModel";
import { PERMANENT } from "../lib/details/planetEdits";
import { classForBodies } from "../lib/details/starBody";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { planetPageKey, useEntityStore } from "./entityStore";
import { deletePlanet, removeColony } from "./planetRemoval";

/** What a save's rows give back to remove one: the deposit, the page's modifier row, the site's id. */
export interface SaveRowRefs {
  deposit: PlanetPageDeposit;
  modifier: ModifierRow;
  digSite: number;
}

/**
 * The refs of an adapter picked by kind alone: a row's ref comes with the target that listed it,
 * so no row can be removed through this one.
 */
type NoRowRefs = { [K in keyof RowRefs]: never };

const NOTHING = Promise.resolve(false);

/** A save body's edits, made by the save's own ops on body `id`. A save takes no ranges. */
function saveEdits({ id }: PlanetBody): PlanetEditAdapter<SaveRowRefs> {
  const apply = (op: Op | null) => (op === null ? NOTHING : useEditorStore.getState().applyOp(op));
  return {
    ranges: false,
    timedModifiers: true,
    rename(text, current) {
      const name = text.trim();
      if (name === "" || name === current) return NOTHING;
      return apply({ type: "RenameBody", body: id, name: { Literal: name } });
    },
    setSize({ min, max }, current) {
      if (min !== max || !Number.isInteger(min) || min < 1 || min === current) return NOTHING;
      return apply({ type: "SetBodySize", body: id, size: min });
    },
    setClass(key, current, planetClasses) {
      const from = planetClasses.get(current);
      const to = planetClasses.get(key);
      if (from === undefined || to === undefined || key === current) return NOTHING;
      return apply({ type: "SetBodyClass", body: id, from: classRule(from), to: classRule(to) });
    },
    setModel(key, current) {
      const entity = key === DEFAULT_MODEL ? null : key;
      if (entity === current) return NOTHING;
      return apply({ type: "SetBodyModel", body: id, entity });
    },
    setRing: (ring) => apply({ type: "SetBodyRing", body: id, ring }),
    setStarType(planetClass, system, starClasses) {
      const next = system.bodies.map((b) => (b.id === id ? planetClass : b.class));
      return apply({
        type: "SetStarClass",
        system: system.id,
        class: classForBodies(next, system.star_class, starClasses) ?? system.star_class,
        bodies: [{ body: id, class: planetClass }],
      });
    },
    remove: (name, moon) => deletePlanet(id, name, moon),
    removeColony: (name) => removeColony(id, name),
    addDeposit: (kind) => apply({ type: "AddDeposit", body: id, kind }),
    removeDeposit: (deposit) => apply({ type: "RemoveDeposit", deposit: deposit.id }),
    addModifier: (choice, days) =>
      apply({
        type: "AddBodyModifier",
        body: id,
        modifier: choice.modifier,
        days: [days ?? PERMANENT],
        ...(choice.feature === null ? {} : { feature: choice.feature }),
      }),
    removeModifier: (row) =>
      apply({
        type: "RemoveBodyModifier",
        body: id,
        modifier: row.modifier,
        ...(row.feature ? { feature: row.key } : {}),
      }),
    addAnomaly: (category) => apply({ type: "AddAnomaly", body: id, category }),
    removeAnomaly: () => apply({ type: "RemoveAnomaly", body: id }),
    addDigSite: (choice) =>
      apply({ type: "AddDigSite", body: id, site_type: choice.key, difficulty: choice.difficulty }),
    removeDigSite: (site) => apply({ type: "RemoveDigSite", site }),
  };
}

/** A document whose bodies take no edits: every one writes nothing. */
const NO_PLANET_EDITS: PlanetEditAdapter<NoRowRefs> = {
  ranges: false,
  timedModifiers: false,
  rename: () => NOTHING,
  setSize: () => NOTHING,
  setClass: () => NOTHING,
  setModel: () => NOTHING,
  setRing: () => NOTHING,
  setStarType: () => NOTHING,
  remove: () => NOTHING,
  removeColony: () => NOTHING,
  addDeposit: () => NOTHING,
  removeDeposit: () => NOTHING,
  addModifier: () => NOTHING,
  removeModifier: () => NOTHING,
  addAnomaly: () => NOTHING,
  removeAnomaly: () => NOTHING,
  addDigSite: () => NOTHING,
  removeDigSite: () => NOTHING,
};

/** Each kind's edits for a body. A new kind fails to compile until its row is written. */
const PLANET_EDITS: Readonly<
  Record<DocumentKind, (body: PlanetBody) => PlanetEditAdapter<NoRowRefs>>
> = {
  save: saveEdits,
  scenario: () => NO_PLANET_EDITS,
};

/** The adapter that edits `body` in a document of `kind`; with no document, one that writes nothing. */
export function planetEditAdapterFor(
  kind: DocumentKind | null,
  body: PlanetBody,
): PlanetEditAdapter<NoRowRefs> {
  return kind === null ? NO_PLANET_EDITS : PLANET_EDITS[kind](body);
}

/** What a body holds that its pickers read. */
export interface HeldRows {
  /** Its deposit types, one entry per deposit. */
  deposits: readonly string[];
  /** The modifiers and planet features it has. */
  modifiers: readonly string[];
  anomaly: HeldAnomaly | null;
}

/** Body `summary` of system `system`, in a document of `kind`, as its pickers read it. */
export function bodyPickerTarget<R extends RowRefs>(
  kind: DocumentKind,
  system: number,
  summary: PlanetSummary,
  held: HeldRows,
  edits: PlanetEditAdapter<R>,
): PickerTarget<R> {
  return {
    key: `${kind}:${system}:${summary.id}`,
    planetClass: summary.class,
    size: summary.size,
    moon: summary.moon,
    ...held,
    edits,
  };
}

/** The anomaly save body `page` holds, with the countries that have found it. */
export function heldAnomaly(page: PlanetPage): HeldAnomaly | null {
  return page.anomaly && { category: page.anomaly.category, foundBy: page.anomaly.found_by };
}

/** Save body `page`, listed as `summary` in system `system` and holding `anomaly`, with its adapter. */
export function savePickerTarget(
  system: number,
  summary: PlanetSummary,
  page: PlanetPage,
  anomaly: HeldAnomaly | null,
): PickerTarget<SaveRowRefs> {
  const held = {
    deposits: page.deposits.map((d) => d.kind),
    modifiers: [...page.planet_modifiers, ...page.timed_modifiers.map((t) => t.modifier)],
    anomaly,
  };
  return bodyPickerTarget("save", system, summary, held, saveEdits({ system, id: summary.id }));
}

/**
 * Whether an edit has left the pages of bodies `ids` or the details of `system` to be read again:
 * until they are, a plan built from them would act on what the bodies held before.
 */
export function bodiesStale(system: number, ids: readonly number[]): boolean {
  const { stalePages, pending } = useEntityStore.getState();
  const { stale } = useDetailsStore.getState();
  return (
    stale.has(system) || ids.some((id) => stalePages.has(id) || pending.has(planetPageKey(id)))
  );
}

/** What the selection page's rows give back to act on: a deposit type, and a planet's modifier row. */
export interface BodiesRowRefs {
  deposit: string;
  modifier: ModifierRow;
  digSite: never;
}

/** Several save bodies' edits: the planet page's, and a row's deposit or modifier for each body without it. */
export interface BodiesEditAdapter extends PlanetEditAdapter<BodiesRowRefs> {
  /** Adds a deposit of type `kind` to each body that has none. */
  fillDeposit(kind: string): Promise<boolean>;
  /** Adds the modifier or feature of `row`, for ever, to each planet without it. */
  fillModifier(row: ModifierRow): Promise<boolean>;
}

/** What several bodies' edits read besides the bodies: where they are and the names their lines use. */
export interface BodiesEditContext {
  bodies: readonly SelectedBody[];
  system: number;
  /** The system as an undo line names it. */
  where: string;
  /** Held while one of the edits sharing it is out, so a second click sends nothing. */
  lock: { sending: boolean };
  depositName(kind: string): string;
  className(key: string): string;
  modifierViews: ReadonlyMap<string, ModifierView>;
}

/**
 * Save bodies `context.bodies` of one system edited at once: each edit is one `Batch` of the ops
 * their own pages send, over the bodies that take it, and `report` hears the line saying what it
 * did and skipped once it is applied.
 */
export function bodiesEdits(
  context: BodiesEditContext,
  report: (note: string | null) => void,
): BodiesEditAdapter {
  const { bodies, where, lock } = context;
  const ids = bodies.map((b) => b.id);
  const send = async (planned: () => BodiesPlan): Promise<boolean> => {
    if (lock.sending || bodiesStale(context.system, ids)) return false;
    const { op, note } = planned();
    if (op === null) {
      report(note);
      return false;
    }
    lock.sending = true;
    try {
      const applied = await useEditorStore.getState().applyOp(op);
      if (applied) report(note);
      return applied;
    } finally {
      lock.sending = false;
    }
  };
  return {
    ...NO_PLANET_EDITS,
    timedModifiers: true,
    setSize: ({ min, max }) => (min === max ? send(() => planSize(bodies, min, where)) : NOTHING),
    setClass: (key, _current, planetClasses) =>
      send(() => planClass(bodies, key, context.className(key), planetClasses, where)),
    setRing: (ring) => send(() => planRing(bodies, ring, where)),
    addDeposit: (kind) =>
      send(() => planAddDeposit(bodies, kind, context.depositName(kind), where)),
    fillDeposit: (kind) =>
      send(() => planFillDeposit(bodies, kind, context.depositName(kind), where)),
    removeDeposit: (kind) =>
      send(() => planRemoveDeposit(bodies, kind, context.depositName(kind), where)),
    addModifier: (choice, days) =>
      send(() =>
        planAddModifier(
          bodies,
          { modifier: choice.modifier, feature: choice.feature },
          days,
          choice.view.name || choice.view.key,
          where,
        ),
      ),
    fillModifier: (row) =>
      send(() => planAddModifier(bodies, pickOf(row), null, row.view?.name || row.key, where)),
    removeModifier: (row) =>
      send(() =>
        planRemoveModifier(
          bodies,
          row.key,
          row.view?.name || row.key,
          context.modifierViews,
          where,
        ),
      ),
  };
}
