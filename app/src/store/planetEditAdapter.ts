/**
 * How a body's page and menus edit it, whatever the document is. Each kind's row in
 * `PLANET_EDITS` builds the op every field sends; `planetEditAdapterFor` applies a row to one body,
 * and `bodiesEdits` maps the same row over several selected bodies at once. This module chooses
 * the row; each kind's row lives in a module of its own.
 */
import type { Bounds } from "../generated/Bounds";
import type { DigSiteChoice } from "../generated/DigSiteChoice";
import type { DocumentKind } from "../generated/DocumentKind";
import type { ModifierChoice } from "../generated/ModifierChoice";
import type { Op } from "../generated/Op";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { PlanetPage } from "../generated/PlanetPage";
import type { PlanetSummary } from "../generated/PlanetSummary";
import type { StarClassView } from "../generated/StarClassView";
import { documentCapabilities } from "../lib/capabilities";
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
  type ModifierPick,
  type SelectedBody,
} from "../lib/details/bodiesEdit";
import type {
  HeldAnomaly,
  PickerTarget,
  PlanetBody,
  PlanetEditAdapter,
  RowRefs,
  StarSystem,
} from "../lib/details/picker";
import { heldModifiers, type ModifierRow } from "../lib/details/planetPage";
import { useDetailsStore } from "./detailsStore";
import type { OpSource } from "./editorEdits";
import { useEditorStore } from "./editorStore";
import { planetPageKey, useEntityStore } from "./entityStore";
import { useFileSessionStore } from "./fileSessionStore";
import { modifierChoices } from "./modifierPickerStore";
import { SAVE_BODY_OPS, type SaveRowRefs } from "./planetEditAdapter.save";

export type { SaveRowRefs };

/**
 * One kind's edits of a body: the op each field sends to body `body`, `null` where it writes
 * nothing, with the rules the matching `PlanetEditAdapter` method states, and the removals,
 * which ask the user first.
 */
export interface BodyOps<R extends RowRefs = RowRefs> {
  ranges: boolean;
  timedModifiers: boolean;
  rename(body: number, text: string, current: string): Op | null;
  setSize(body: number, size: Bounds, current: number | null): Op | null;
  setClass(
    body: number,
    key: string,
    current: string,
    planetClasses: ReadonlyMap<string, PlanetClassView>,
  ): Op | null;
  setModel(body: number, key: string, current: string | null): Op | null;
  setRing(body: number, ring: boolean): Op | null;
  setStarType(
    body: number,
    planetClass: string,
    system: StarSystem,
    starClasses: ReadonlyMap<string, StarClassView>,
  ): Op | null;
  addDeposit(body: number, kind: string): Op | null;
  removeDeposit(ref: R["deposit"]): Op | null;
  /** Adds `pick` for `days`, or for ever when `null`. */
  addModifier(body: number, pick: ModifierPick, days: number | null): Op | null;
  /** The modifiers and features body `body` holds, read from the session as it is now. */
  heldModifiers(body: number): Promise<readonly string[]>;
  /**
   * Removes `ref` from a body with the modifiers and features `has`, and the planet flags its
   * choice in `choices` sets that no other it keeps sets too.
   */
  removeModifier(
    body: number,
    ref: R["modifier"],
    has: readonly string[],
    choices: readonly ModifierChoice[],
  ): Op | null;
  addAnomaly(body: number, category: string): Op | null;
  removeAnomaly(body: number): Op | null;
  addDigSite(body: number, choice: DigSiteChoice): Op | null;
  removeDigSite(ref: R["digSite"]): Op | null;
  remove(body: number, name: string, moon: boolean): Promise<boolean>;
  removeColony(body: number, name: string): Promise<boolean>;
}

/**
 * The refs of an adapter picked by kind alone: a row's ref comes with the target that listed it,
 * so no row can be removed through this one.
 */
type NoRowRefs = { [K in keyof RowRefs]: never };

const NOTHING = Promise.resolve(false);
const NO_OP = () => null;

/** A document whose bodies take no edits: no field builds an op. */
const NO_BODY_OPS: BodyOps = {
  ranges: false,
  timedModifiers: false,
  rename: NO_OP,
  setSize: NO_OP,
  setClass: NO_OP,
  setModel: NO_OP,
  setRing: NO_OP,
  setStarType: NO_OP,
  addDeposit: NO_OP,
  removeDeposit: NO_OP,
  addModifier: NO_OP,
  heldModifiers: async () => [],
  removeModifier: NO_OP,
  addAnomaly: NO_OP,
  removeAnomaly: NO_OP,
  addDigSite: NO_OP,
  removeDigSite: NO_OP,
  remove: () => NOTHING,
  removeColony: () => NOTHING,
};

/** Each kind's edits for a body. A new kind fails to compile until its row is written. */
const PLANET_EDITS: Readonly<Record<DocumentKind, BodyOps>> = {
  save: SAVE_BODY_OPS,
  scenario: NO_BODY_OPS,
};

function apply(op: OpSource | null): Promise<boolean> {
  return op === null ? NOTHING : useEditorStore.getState().applyOp(op);
}

/**
 * The removal of row `ref` from body `body`, built inside the edit queue from what the body holds
 * once every edit queued before it has landed. A failed read of the choices refuses it.
 */
function removalOf<R extends RowRefs>(ops: BodyOps<R>, body: number, ref: R["modifier"]): OpSource {
  return async () => {
    const [has, choices] = await Promise.all([ops.heldModifiers(body), modifierChoices()]);
    return ops.removeModifier(body, ref, has, choices);
  };
}

/** Body `id` edited by the ops of `ops`. */
function editsOf<R extends RowRefs>(ops: BodyOps<R>, { id }: PlanetBody): PlanetEditAdapter<R> {
  return {
    ranges: ops.ranges,
    timedModifiers: ops.timedModifiers,
    rename: (text, current) => apply(ops.rename(id, text, current)),
    setSize: (size, current) => apply(ops.setSize(id, size, current)),
    setClass: (key, current, planetClasses) => apply(ops.setClass(id, key, current, planetClasses)),
    setModel: (key, current) => apply(ops.setModel(id, key, current)),
    setRing: (ring) => apply(ops.setRing(id, ring)),
    setStarType: (planetClass, system, starClasses) =>
      apply(ops.setStarType(id, planetClass, system, starClasses)),
    remove: (name, moon) => ops.remove(id, name, moon),
    removeColony: (name) => ops.removeColony(id, name),
    addDeposit: (kind) => apply(ops.addDeposit(id, kind)),
    removeDeposit: (ref) => apply(ops.removeDeposit(ref)),
    addModifier: (choice, days) => apply(ops.addModifier(id, choice, days)),
    removeModifier: (ref) => apply(removalOf(ops, id, ref)),
    addAnomaly: (category) => apply(ops.addAnomaly(id, category)),
    removeAnomaly: () => apply(ops.removeAnomaly(id)),
    addDigSite: (choice) => apply(ops.addDigSite(id, choice)),
    removeDigSite: (ref) => apply(ops.removeDigSite(ref)),
  };
}

/** A body that takes no edits: every one writes nothing. */
const NO_EDITS: PlanetEditAdapter<NoRowRefs> = editsOf(NO_BODY_OPS, { system: null, id: -1 });

/** The adapter that edits `body` in a document of `kind`; with no document, one that writes nothing. */
export function planetEditAdapterFor(
  kind: DocumentKind | null,
  body: PlanetBody,
): PlanetEditAdapter<NoRowRefs> {
  return kind === null ? NO_EDITS : editsOf(PLANET_EDITS[kind], body);
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
    modifiers: heldModifiers(page),
    anomaly,
  };
  const edits = editsOf(SAVE_BODY_OPS, { system, id: summary.id });
  return bodyPickerTarget("save", system, summary, held, edits);
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

/** Several bodies' edits: the planet page's, and a row's deposit or modifier for each body without it. */
export interface BodiesEditAdapter extends PlanetEditAdapter<BodiesRowRefs> {
  /** Adds a deposit of type `kind` to each body that has none. */
  fillDeposit(kind: string): Promise<boolean>;
  /** Adds the modifier or feature of `row`, for ever, to each planet without it. */
  fillModifier(row: ModifierRow): Promise<boolean>;
}

/** What several bodies' edits read besides the bodies: where they are and the names their lines use. */
export interface BodiesEditContext {
  /** The kind of document the bodies were read from, whose row builds their ops. */
  kind: DocumentKind;
  bodies: readonly SelectedBody[];
  system: number;
  /** The system as an undo line names it. */
  where: string;
  /** Held while one of the edits sharing it is out, so a second click sends nothing. */
  lock: { sending: boolean };
  depositName(kind: string): string;
  className(key: string): string;
}

/** Whether the open document takes edits of several bodies at once. */
function editsBodies(): boolean {
  return documentCapabilities(useFileSessionStore.getState()).edit_bodies;
}

/**
 * Bodies `context.bodies` of one system edited at once: each edit is one `Batch` of the ops their
 * own pages send, over the bodies that take it, and `report` hears the line saying what it did
 * and skipped once it is applied. Nothing is sent while the document takes no such edit.
 */
export function bodiesEdits(
  context: BodiesEditContext,
  report: (note: string | null) => void,
): BodiesEditAdapter {
  const { bodies, where, lock } = context;
  const ops = PLANET_EDITS[context.kind];
  const ids = bodies.map((b) => b.id);
  /** Sends the plan `planned` builds inside the edit queue; its line is reported once applied, or when it sends nothing. */
  const send = async (planned: () => BodiesPlan | Promise<BodiesPlan>): Promise<boolean> => {
    if (lock.sending || !editsBodies() || bodiesStale(context.system, ids)) return false;
    lock.sending = true;
    const built: { plan?: BodiesPlan } = {};
    try {
      const applied = await useEditorStore.getState().applyOp(async () => {
        built.plan = await planned();
        return built.plan.op;
      });
      if (built.plan !== undefined && (applied || built.plan.op === null)) report(built.plan.note);
      return applied;
    } finally {
      lock.sending = false;
    }
  };
  const planAdd = (pick: ModifierPick, days: number | null, name: string) =>
    planAddModifier(bodies, pick, name, where, (b) => ops.addModifier(b.id, pick, days));
  return {
    ...NO_EDITS,
    timedModifiers: ops.timedModifiers,
    setSize: (size) =>
      size.min === size.max
        ? send(() =>
            planSize(bodies, size.min, where, (b) => ops.setSize(b.id, size, b.summary.size)),
          )
        : NOTHING,
    setClass: (key, _current, planetClasses) =>
      send(() =>
        planClass(bodies, key, context.className(key), planetClasses, where, (b) =>
          ops.setClass(b.id, key, b.summary.class, planetClasses),
        ),
      ),
    setRing: (ring) => send(() => planRing(bodies, ring, where, (b) => ops.setRing(b.id, ring))),
    addDeposit: (kind) =>
      send(() =>
        planAddDeposit(bodies, context.depositName(kind), where, (b) => ops.addDeposit(b.id, kind)),
      ),
    fillDeposit: (kind) =>
      send(() =>
        planFillDeposit(bodies, kind, context.depositName(kind), where, (b) =>
          ops.addDeposit(b.id, kind),
        ),
      ),
    removeDeposit: (kind) =>
      send(() =>
        planRemoveDeposit(bodies, kind, context.depositName(kind), where, (_b, ref) =>
          ops.removeDeposit(ref),
        ),
      ),
    addModifier: (choice, days) =>
      send(() => planAdd(choice, days, choice.view.name || choice.view.key)),
    fillModifier: (row) =>
      send(async () =>
        planAdd(pickOf(row, await modifierChoices()), null, row.view?.name || row.key),
      ),
    removeModifier: (row) =>
      send(async () => {
        const [held, choices] = await Promise.all([
          Promise.all(bodies.map(async (b) => [b.id, await ops.heldModifiers(b.id)] as const)),
          modifierChoices(),
        ]);
        const has = new Map(held);
        return planRemoveModifier(bodies, row.key, row.view?.name || row.key, where, (b, ref) =>
          ops.removeModifier(b.id, ref, has.get(b.id) ?? [], choices),
        );
      }),
  };
}
