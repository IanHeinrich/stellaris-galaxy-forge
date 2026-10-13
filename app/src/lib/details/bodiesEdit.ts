/**
 * Several bodies of one system edited at once from the selection page: which bodies each field
 * leaves out and why, the deposit and modifier rows it lists with who has each, and the one
 * `Batch` each action sends, with the line that says what it did and what it skipped. Each body
 * is held to the rules its own page keeps, so a batch leaves out the bodies its ops would refuse,
 * and each op is the one its own page sends, built by the caller.
 */
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import { counted, listed } from "../text";
import { holdsModifier } from "./modifierPicker";
import { CLASS_FIXED, classFieldReason, COLONY_CLASS_FIXED } from "./planetClass";
import { depositGroups, type DepositGroup, type ModifierRow } from "./planetPage";
import { hasRingCheckbox } from "./ring";
import { isStar } from "./starBody";

/** A field of the selection page that some bodies take no edit of. Every body takes deposits. */
export type BodyField = "size" | "class" | "ring" | "modifiers";

type SkipKind =
  | "star"
  | "moon"
  | "asteroid"
  | "ringWorld"
  | "fixedClass"
  | "colonyClass"
  | "megastructure"
  | "noSize";

/** Why a body takes no edit of a field: its kind, and what follows its name in a hover. */
export interface Skip {
  kind: SkipKind;
  why: string;
}

const SKIP_NOUNS: Record<SkipKind, readonly [string, string]> = {
  star: ["star", "stars"],
  moon: ["moon", "moons"],
  asteroid: ["asteroid", "asteroids"],
  ringWorld: ["ring world segment", "ring world segments"],
  fixedClass: ["planet that keeps its class", "planets that keep their class"],
  colonyClass: ["colony that keeps its class", "colonies that keep their class"],
  megastructure: ["planet with a megastructure", "planets with a megastructure"],
  noSize: ["body with no size", "bodies with no size"],
};

/** One deposit row of a body: its type, and what a removal takes off; `null` where none can go. */
export interface SelectedDeposit {
  kind: string;
  /** What the body's source takes back to remove the deposit, and what the game takes with it. */
  removal: { ref: unknown; warnings: readonly string[] } | null;
}

/** What a body's page lists, as its document's source reads it, each row with what it gives back. */
export interface SelectedRows {
  deposits: {
    features: readonly SelectedDeposit[];
    blockers: readonly SelectedDeposit[];
    /** What the game takes away for an add of type `key`. */
    addWarnings(key: string): readonly string[];
  };
  modifiers: readonly { row: ModifierRow; ref: unknown }[];
}

/** What a body holds that its pickers read. */
export interface HeldKeys {
  /** Its deposit types, one entry per deposit. */
  deposits: readonly string[];
  /** The modifiers and planet features it has. */
  modifiers: readonly string[];
}

/** One body as its document's source reads it. */
export interface BodyReadOf {
  summary: PlanetSummary;
  rows: SelectedRows;
  held: HeldKeys;
}

/** One selected body: what its source reads of it, and what it is left out of. */
export interface SelectedBody extends BodyReadOf {
  id: number;
  name: string;
  star: boolean;
  skips: Partial<Record<BodyField, Skip>>;
}

/** What `selectedBody` reads besides the body. */
export interface BodyFacts {
  planetClasses: ReadonlyMap<string, PlanetClassView>;
  starClasses: ReadonlyMap<string, StarClassView>;
  /** The bodies of the system a megastructure is built at. */
  megastructures: ReadonlySet<number>;
}

function classSkip(summary: PlanetSummary, star: boolean, facts: BodyFacts): Skip | undefined {
  if (star) return { kind: "star", why: "is a star" };
  const reason = classFieldReason(summary.class, summary.colonised, facts.planetClasses);
  if (reason === CLASS_FIXED) return { kind: "fixedClass", why: "keeps its class" };
  if (reason === COLONY_CLASS_FIXED) {
    return { kind: "colonyClass", why: "is a colony on a class it keeps" };
  }
  if (facts.megastructures.has(summary.id)) {
    return { kind: "megastructure", why: "has a megastructure" };
  }
  return undefined;
}

function ringSkip(summary: PlanetSummary, star: boolean, facts: BodyFacts): Skip | undefined {
  if (star) return { kind: "star", why: "is a star" };
  const ring = summary.ring === true;
  if (summary.moon && !ring) return { kind: "moon", why: "is a moon without a ring" };
  if (
    hasRingCheckbox(
      { class: summary.class, moon: summary.moon, ring },
      facts.planetClasses,
      facts.starClasses,
    )
  ) {
    return undefined;
  }
  return facts.planetClasses.get(summary.class)?.asteroid === true
    ? { kind: "asteroid", why: "is an asteroid" }
    : { kind: "ringWorld", why: "is a ring world segment" };
}

/** Body `read`, named `name`, as the selection page edits it. */
export function selectedBody(read: BodyReadOf, name: string, facts: BodyFacts): SelectedBody {
  const { summary } = read;
  const star = isStar(summary, facts);
  const skips: Partial<Record<BodyField, Skip>> = {
    size: summary.size === null ? { kind: "noSize", why: "has no size" } : undefined,
    class: classSkip(summary, star, facts),
    ring: ringSkip(summary, star, facts),
    modifiers: star ? { kind: "star", why: "is a star" } : undefined,
  };
  return { ...read, id: summary.id, name, star, skips };
}

/** The bodies that take `field`. */
export function takers(bodies: readonly SelectedBody[], field: BodyField): SelectedBody[] {
  return bodies.filter((b) => b.skips[field] === undefined);
}

/** What a field leaves out, by kind and count: "the star", "2 stars", "1 asteroid". */
function skippedKinds(bodies: readonly SelectedBody[], field: BodyField): string[] {
  const counts = new Map<SkipKind, number>();
  for (const body of bodies) {
    const skip = body.skips[field];
    if (skip !== undefined) counts.set(skip.kind, (counts.get(skip.kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) =>
    kind === "star" && n === 1 ? "the star" : counted(n, ...SKIP_NOUNS[kind]),
  );
}

/** The line under a field: "Skips the star and 1 asteroid.", and its hover naming each body and why. */
export interface SkipLine {
  text: string;
  title: string;
}

/** What `field` leaves out of `bodies`, or `null` when it takes every one. */
export function skipLine(bodies: readonly SelectedBody[], field: BodyField): SkipLine | null {
  const kinds = skippedKinds(bodies, field);
  if (kinds.length === 0) return null;
  const title = bodies
    .flatMap((b) => {
      const skip = b.skips[field];
      return skip === undefined ? [] : [`${b.name} ${skip.why}`];
    })
    .join("\n");
  return { text: `Skips ${listed(kinds, "and")}.`, title };
}

/** "3 planets", or "3 bodies" when a star is among them. */
function bodiesNoun(bodies: readonly SelectedBody[]): string {
  return bodies.some((b) => b.star)
    ? counted(bodies.length, "body", "bodies")
    : counted(bodies.length, "planet");
}

/** The bodies an action passed over, and the clause that says why: "which has it". */
interface Passed {
  bodies: readonly SelectedBody[];
  why: readonly [string, string];
}

/** What a selection page action sends, one undo step, and the line it leaves under its section. */
export interface BodiesPlan {
  /** `null` when no body changes. */
  op: Op | null;
  note: string | null;
}

const NOTHING: BodiesPlan = { op: null, note: null };

/** The op a body's own page sends for an edit, or `null` where it changes nothing. */
export type BodyOp = (body: SelectedBody) => Op | null;

/** The op a body's own page sends to remove the row that gave back `ref`. */
export type RowOp = (body: SelectedBody, ref: unknown) => Op | null;

/** The bodies of `bodies` that `opOf` builds an op for, and those ops in the same order. */
function opsFor(
  bodies: readonly SelectedBody[],
  opOf: BodyOp,
): { sent: SelectedBody[]; ops: Op[] } {
  const sent: SelectedBody[] = [];
  const ops: Op[] = [];
  for (const body of bodies) {
    const op = opOf(body);
    if (op === null) continue;
    sent.push(body);
    ops.push(op);
  }
  return { sent, ops };
}

/**
 * The plan that sends `ops` as one edit described `${done} in ${where}`, and the note saying
 * `done` and who was skipped: those `field` leaves out and those `passed` says why it passed.
 */
function plan(
  ops: readonly Op[],
  done: string,
  where: string,
  skipped: { all: readonly SelectedBody[]; field?: BodyField; passed?: readonly Passed[] },
): BodiesPlan {
  const { all, field, passed = [] } = skipped;
  const parts = field === undefined ? [] : skippedKinds(all, field);
  for (const { bodies, why } of passed) {
    if (bodies.length === 0) continue;
    const [one, many] = why;
    parts.push(
      `${listed(
        bodies.map((b) => b.name),
        "and",
      )}, ${bodies.length === 1 ? one : many}`,
    );
  }
  const skips = parts.length === 0 ? "" : ` Skipped ${listed(parts, "and")}.`;
  if (ops.length === 0) return { op: null, note: `Nothing changed.${skips}` };
  return {
    op: { type: "Batch", description: `${done} in ${where}`, ops: [...ops] },
    note: `${done}.${skips}`,
  };
}

function split(
  bodies: readonly SelectedBody[],
  test: (body: SelectedBody) => boolean,
): [SelectedBody[], SelectedBody[]] {
  return [bodies.filter(test), bodies.filter((b) => !test(b))];
}

/** Size `size` on every body that takes one and has another; nothing for a size under 1 or a fraction. */
export function planSize(
  bodies: readonly SelectedBody[],
  size: number,
  where: string,
  opOf: BodyOp,
): BodiesPlan {
  if (!Number.isInteger(size) || size < 1) return NOTHING;
  const [changed, same] = split(takers(bodies, "size"), (b) => b.summary.size !== size);
  const { sent, ops } = opsFor(changed, opOf);
  return plan(ops, `Set the size of ${bodiesNoun(sent)} to ${size}`, where, {
    all: bodies,
    field: "size",
    passed: [{ bodies: same, why: [`which is already ${size}`, `which are already ${size}`] }],
  });
}

/** Class `key`, named `label`, on every planet that may change class and has another. */
export function planClass(
  bodies: readonly SelectedBody[],
  key: string,
  label: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  where: string,
  opOf: BodyOp,
): BodiesPlan {
  if (!planetClasses.has(key)) return NOTHING;
  const [differ, same] = split(takers(bodies, "class"), (b) => b.summary.class !== key);
  const [changed, unknown] = split(differ, (b) => planetClasses.has(b.summary.class));
  const { sent, ops } = opsFor(changed, opOf);
  return plan(ops, `Changed ${bodiesNoun(sent)} to ${label}`, where, {
    all: bodies,
    field: "class",
    passed: [
      { bodies: same, why: [`which is already ${label}`, `which are already ${label}`] },
      {
        bodies: unknown,
        why: ["whose class the game data doesn't list", "whose classes the game data doesn't list"],
      },
    ],
  });
}

/** How many of the planets that take a ring have one. */
export function ringSpread(bodies: readonly SelectedBody[]): { has: number; of: number } {
  const ringed = takers(bodies, "ring");
  return { has: ringed.filter((b) => b.summary.ring === true).length, of: ringed.length };
}

/** A ring on, or off, every planet that takes one and is not so already. */
export function planRing(
  bodies: readonly SelectedBody[],
  ring: boolean,
  where: string,
  opOf: BodyOp,
): BodiesPlan {
  const changed = takers(bodies, "ring").filter((b) => (b.summary.ring === true) !== ring);
  const { sent, ops } = opsFor(changed, opOf);
  const noun = bodiesNoun(sent);
  return plan(ops, ring ? `Added a ring to ${noun}` : `Removed the ring from ${noun}`, where, {
    all: bodies,
    field: "ring",
  });
}

/** A deposit type found on any selected body, and the bodies that have one or more. */
export interface DepositSpread {
  group: DepositGroup;
  holders: SelectedBody[];
}

function holdsDeposit(body: SelectedBody, kind: string): boolean {
  return body.held.deposits.includes(kind);
}

/** Every deposit type on any of `bodies`, one row each in the planet page's order, and the blockers apart. */
export function depositSpread(
  bodies: readonly SelectedBody[],
  views: ReadonlyMap<string, DepositTypeView>,
): { features: DepositSpread[]; blockers: DepositSpread[] } {
  const kinds = [...new Set(bodies.flatMap((b) => b.held.deposits))];
  const { features, blockers } = depositGroups(
    kinds.map((kind, id) => ({ id, kind, swap_type: null })),
    views,
  );
  const spread = (group: DepositGroup): DepositSpread => ({
    group,
    holders: bodies.filter((b) => holdsDeposit(b, group.kind)),
  });
  return { features: features.map(spread), blockers: blockers.map(spread) };
}

/** "on 2 of 5 · Meissa I, Meissa III", or "on 5 of 5" when every one has it. */
export function spreadLine(holders: readonly SelectedBody[], of: number): string {
  const on = `on ${holders.length} of ${of}`;
  return holders.length === of ? on : `${on} · ${holders.map((b) => b.name).join(", ")}`;
}

/** A deposit, named `name`, on every body: a body that has one gets another. */
export function planAddDeposit(
  bodies: readonly SelectedBody[],
  name: string,
  where: string,
  opOf: BodyOp,
): BodiesPlan {
  const { sent, ops } = opsFor(bodies, opOf);
  return plan(ops, `Added ${name} to ${bodiesNoun(sent)}`, where, { all: bodies });
}

/** A deposit of type `kind`, named `name`, on every body that has none. */
export function planFillDeposit(
  bodies: readonly SelectedBody[],
  kind: string,
  name: string,
  where: string,
  opOf: BodyOp,
): BodiesPlan {
  return planAddDeposit(
    bodies.filter((b) => !holdsDeposit(b, kind)),
    name,
    where,
    opOf,
  );
}

/** What removing type `kind` from `body` takes off, as its own page's last row of it would. */
function depositToRemove(body: SelectedBody, kind: string) {
  const { features, blockers } = body.rows.deposits;
  const rows = [...features, ...blockers].filter((d) => d.kind === kind && d.removal !== null);
  return rows[rows.length - 1]?.removal ?? null;
}

/** One deposit of type `kind` off every body that has one, by what its row gives back. */
export function planRemoveDeposit(
  bodies: readonly SelectedBody[],
  kind: string,
  name: string,
  where: string,
  opOf: RowOp,
): BodiesPlan {
  const { sent, ops } = opsFor(bodies, (b) => {
    const removal = depositToRemove(b, kind);
    return removal === null ? null : opOf(b, removal.ref);
  });
  return plan(ops, `Removed ${name} from ${bodiesNoun(sent)}`, where, { all: bodies });
}

/**
 * What removing one deposit of type `kind` from every body that has one costs their colonies,
 * as each one's own page would warn: each warning after the body's name when several have one.
 */
export function removeDepositWarnings(bodies: readonly SelectedBody[], kind: string): string[] {
  const holders = bodies.filter((b) => holdsDeposit(b, kind));
  return holders.flatMap((b) => {
    const warnings = depositToRemove(b, kind)?.warnings ?? [];
    return holders.length === 1 ? warnings : warnings.map((w) => `${b.name}: ${w}`);
  });
}

/** What adding a deposit of type `kind` to every body costs their colonies, named as `removeDepositWarnings` names them. */
export function addDepositWarnings(bodies: readonly SelectedBody[], kind: string): string[] {
  return bodies.flatMap((b) => {
    const warnings = b.rows.deposits.addWarnings(kind);
    return bodies.length === 1 ? warnings : warnings.map((w) => `${b.name}: ${w}`);
  });
}

/** A modifier or planet feature found on any selected planet, and the planets that have it. */
export interface ModifierSpread {
  row: ModifierRow;
  holders: SelectedBody[];
}

/** Every modifier and planet feature on any planet of `bodies` that takes modifiers, one row each. */
export function modifierSpread(bodies: readonly SelectedBody[]): ModifierSpread[] {
  const rows = new Map<string, ModifierSpread>();
  for (const body of takers(bodies, "modifiers")) {
    for (const { row } of body.rows.modifiers) {
      const spread = rows.get(row.key);
      if (spread === undefined) rows.set(row.key, { row, holders: [body] });
      else if (!spread.holders.includes(body)) spread.holders.push(body);
    }
  }
  return [...rows.values()];
}

/** A modifier and the feature that applies it, as an add takes them. */
export interface ModifierPick {
  modifier: string;
  feature: string | null;
}

/** What adding row `row` again means: its modifier, and its feature when it is one. */
export function pickOf(row: ModifierRow): ModifierPick {
  return { modifier: row.modifier, feature: row.feature ? row.key : null };
}

/** `pick`, named `name`, on every planet that takes modifiers and has not got it. */
export function planAddModifier(
  bodies: readonly SelectedBody[],
  pick: ModifierPick,
  name: string,
  where: string,
  opOf: BodyOp,
): BodiesPlan {
  const [has, lacking] = split(takers(bodies, "modifiers"), (b) =>
    holdsModifier(b.held.modifiers, pick.modifier, pick.feature),
  );
  const { sent, ops } = opsFor(lacking, opOf);
  return plan(ops, `Added ${name} to ${bodiesNoun(sent)}`, where, {
    all: bodies,
    field: "modifiers",
    passed: [{ bodies: has, why: ["which has it", "which have it"] }],
  });
}

/** The modifier or feature row `key`, named `name`, off every planet that has it, by what its row gives back. */
export function planRemoveModifier(
  bodies: readonly SelectedBody[],
  key: string,
  name: string,
  where: string,
  opOf: RowOp,
): BodiesPlan {
  const { sent, ops } = opsFor(takers(bodies, "modifiers"), (b) => {
    const held = b.rows.modifiers.find(({ row }) => row.key === key);
    return held === undefined ? null : opOf(b, held.ref);
  });
  return plan(ops, `Removed ${name} from ${bodiesNoun(sent)}`, where, { all: bodies });
}
