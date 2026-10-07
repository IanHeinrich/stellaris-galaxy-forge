/**
 * Several save bodies of one system edited at once from the selection page: which bodies each
 * field leaves out and why, the deposit and modifier rows it lists with who has each, and the one
 * `Batch` each action sends, with the line that says what it did and what it skipped. Each body
 * is held to the rules its own page keeps, so a batch leaves out the bodies its ops would refuse.
 */
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { ModifierView } from "../../generated/ModifierView";
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { Names } from "../names";
import { counted } from "../text";
import { addWarnings, removalTarget, removalWarnings } from "./depositWarnings";
import { holdsModifier } from "./modifierPicker";
import { CLASS_FIXED, classFieldReason, classRule, COLONY_CLASS_FIXED } from "./planetClass";
import { PERMANENT } from "./planetEdits";
import { depositGroups, modifierRows, type DepositGroup, type ModifierRow } from "./planetPage";
import { hasRingCheckbox } from "./ring";
import { isStarBody } from "./starBody";

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

/** One selected body: what its system's details and its own page say, and what it is left out of. */
export interface SelectedBody {
  id: number;
  name: string;
  summary: PlanetSummary;
  page: PlanetPage;
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
  const asteroid =
    facts.planetClasses.get(summary.class)?.asteroid === true || summary.class.includes("asteroid");
  return asteroid
    ? { kind: "asteroid", why: "is an asteroid" }
    : { kind: "ringWorld", why: "is a ring world segment" };
}

/** Body `summary`, named `name`, with its page, as the selection page edits it. */
export function selectedBody(
  summary: PlanetSummary,
  page: PlanetPage,
  name: string,
  facts: BodyFacts,
): SelectedBody {
  const star =
    summary.star_class !== undefined ||
    isStarBody(summary.class, facts.planetClasses, facts.starClasses);
  const skips: Partial<Record<BodyField, Skip>> = {
    size: summary.size === null ? { kind: "noSize", why: "has no size" } : undefined,
    class: classSkip(summary, star, facts),
    ring: ringSkip(summary, star, facts),
    modifiers: star ? { kind: "star", why: "is a star" } : undefined,
  };
  return { id: summary.id, name, summary, page, star, skips };
}

/** The bodies that take `field`. */
export function takers(bodies: readonly SelectedBody[], field: BodyField): SelectedBody[] {
  return bodies.filter((b) => b.skips[field] === undefined);
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
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
  return { text: `Skips ${listed(kinds)}.`, title };
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
    parts.push(`${listed(bodies.map((b) => b.name))}, ${bodies.length === 1 ? one : many}`);
  }
  const skips = parts.length === 0 ? "" : ` Skipped ${listed(parts)}.`;
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
export function planSize(bodies: readonly SelectedBody[], size: number, where: string): BodiesPlan {
  if (!Number.isInteger(size) || size < 1) return NOTHING;
  const [changed, same] = split(takers(bodies, "size"), (b) => b.summary.size !== size);
  return plan(
    changed.map((b): Op => ({ type: "SetBodySize", body: b.id, size })),
    `Set the size of ${bodiesNoun(changed)} to ${size}`,
    where,
    {
      all: bodies,
      field: "size",
      passed: [{ bodies: same, why: [`which is already ${size}`, `which are already ${size}`] }],
    },
  );
}

/** Class `key`, named `label`, on every planet that may change class and has another. */
export function planClass(
  bodies: readonly SelectedBody[],
  key: string,
  label: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  where: string,
): BodiesPlan {
  const to = planetClasses.get(key);
  if (to === undefined) return NOTHING;
  const [differ, same] = split(takers(bodies, "class"), (b) => b.summary.class !== key);
  const [changed, unknown] = split(differ, (b) => planetClasses.has(b.summary.class));
  const ops = changed.flatMap((b): Op[] => {
    const from = planetClasses.get(b.summary.class);
    return from === undefined
      ? []
      : [{ type: "SetBodyClass", body: b.id, from: classRule(from), to: classRule(to) }];
  });
  return plan(ops, `Changed ${bodiesNoun(changed)} to ${label}`, where, {
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
): BodiesPlan {
  const changed = takers(bodies, "ring").filter((b) => (b.summary.ring === true) !== ring);
  const noun = bodiesNoun(changed);
  return plan(
    changed.map((b): Op => ({ type: "SetBodyRing", body: b.id, ring })),
    ring ? `Added a ring to ${noun}` : `Removed the ring from ${noun}`,
    where,
    { all: bodies, field: "ring" },
  );
}

/** A deposit type found on any selected body, and the bodies that have one or more. */
export interface DepositSpread {
  group: DepositGroup;
  holders: SelectedBody[];
}

function holdsDeposit(body: SelectedBody, kind: string): boolean {
  return body.page.deposits.some((d) => d.kind === kind);
}

/** Every deposit type on any of `bodies`, one row each in the planet page's order, and the blockers apart. */
export function depositSpread(
  bodies: readonly SelectedBody[],
  views: ReadonlyMap<string, DepositTypeView>,
): { features: DepositSpread[]; blockers: DepositSpread[] } {
  const kinds = [...new Set(bodies.flatMap((b) => b.page.deposits.map((d) => d.kind)))];
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

/** A deposit of type `kind`, named `name`, on every body: a body that has one gets another. */
export function planAddDeposit(
  bodies: readonly SelectedBody[],
  kind: string,
  name: string,
  where: string,
): BodiesPlan {
  return plan(
    bodies.map((b): Op => ({ type: "AddDeposit", body: b.id, kind })),
    `Added ${name} to ${bodiesNoun(bodies)}`,
    where,
    { all: bodies },
  );
}

/** A deposit of type `kind` on every body that has none. */
export function planFillDeposit(
  bodies: readonly SelectedBody[],
  kind: string,
  name: string,
  where: string,
): BodiesPlan {
  return planAddDeposit(
    bodies.filter((b) => !holdsDeposit(b, kind)),
    kind,
    name,
    where,
  );
}

/** The deposit of type `kind` a removal takes off `body`, as its own page's would. */
function depositToRemove(body: SelectedBody, kind: string) {
  const held = body.page.deposits.filter((d) => d.kind === kind);
  const last = held[held.length - 1];
  return last === undefined ? null : removalTarget(body.page, kind, last.swap_type);
}

/** One deposit of type `kind` off every body that has one. */
export function planRemoveDeposit(
  bodies: readonly SelectedBody[],
  kind: string,
  name: string,
  where: string,
): BodiesPlan {
  const removed = bodies.flatMap((b) => {
    const deposit = depositToRemove(b, kind);
    return deposit === null ? [] : [{ body: b, deposit }];
  });
  return plan(
    removed.map(({ deposit }): Op => ({ type: "RemoveDeposit", deposit: deposit.id })),
    `Removed ${name} from ${bodiesNoun(removed.map(({ body }) => body))}`,
    where,
    { all: bodies },
  );
}

/**
 * What removing one deposit of type `kind` from every body that has one costs their colonies,
 * as each one's own page would warn: each warning after the body's name when several have one.
 */
export function removeDepositWarnings(
  bodies: readonly SelectedBody[],
  kind: string,
  views: ReadonlyMap<string, DepositTypeView>,
  names: Names,
): string[] {
  const holders = bodies.filter((b) => holdsDeposit(b, kind));
  return holders.flatMap((b) => {
    const deposit = depositToRemove(b, kind);
    if (deposit === null) return [];
    const warnings = removalWarnings(b.page, deposit, views, names);
    return holders.length === 1 ? warnings : warnings.map((w) => `${b.name}: ${w}`);
  });
}

/** What adding a deposit of type `kind` to every body costs their colonies, named as `removeDepositWarnings` names them. */
export function addDepositWarnings(
  bodies: readonly SelectedBody[],
  kind: string,
  views: ReadonlyMap<string, DepositTypeView>,
  names: Names,
): string[] {
  return bodies.flatMap((b) => {
    const warnings = addWarnings(b.page, kind, views, names);
    return bodies.length === 1 ? warnings : warnings.map((w) => `${b.name}: ${w}`);
  });
}

/** A modifier or planet feature found on any selected planet, and the planets that have it. */
export interface ModifierSpread {
  row: ModifierRow;
  holders: SelectedBody[];
}

/** Every modifier and planet feature on any planet of `bodies` that takes modifiers, one row each. */
export function modifierSpread(
  bodies: readonly SelectedBody[],
  views: ReadonlyMap<string, ModifierView>,
): ModifierSpread[] {
  const rows = new Map<string, ModifierSpread>();
  for (const body of takers(bodies, "modifiers")) {
    for (const row of modifierRows(body.page, views)) {
      const spread = rows.get(row.key);
      if (spread === undefined) rows.set(row.key, { row, holders: [body] });
      else if (!spread.holders.includes(body)) spread.holders.push(body);
    }
  }
  return [...rows.values()];
}

/** The modifiers and planet features `body` has, as its picker reads them. */
export function heldModifiers(body: SelectedBody): string[] {
  return [...body.page.planet_modifiers, ...body.page.timed_modifiers.map((t) => t.modifier)];
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

/** `pick`, named `name`, for `days` or for ever, on every planet that takes modifiers and has not got it. */
export function planAddModifier(
  bodies: readonly SelectedBody[],
  pick: ModifierPick,
  days: number | null,
  name: string,
  where: string,
): BodiesPlan {
  const [has, lacking] = split(takers(bodies, "modifiers"), (b) =>
    holdsModifier(heldModifiers(b), pick.modifier, pick.feature),
  );
  return plan(
    lacking.map((b): Op => ({
      type: "AddBodyModifier",
      body: b.id,
      modifier: pick.modifier,
      days: [days ?? PERMANENT],
      ...(pick.feature === null ? {} : { feature: pick.feature }),
    })),
    `Added ${name} to ${bodiesNoun(lacking)}`,
    where,
    {
      all: bodies,
      field: "modifiers",
      passed: [{ bodies: has, why: ["which has it", "which have it"] }],
    },
  );
}

/** The modifier or feature row `key`, named `name`, off every planet that has it, as each one's page removes it. */
export function planRemoveModifier(
  bodies: readonly SelectedBody[],
  key: string,
  name: string,
  views: ReadonlyMap<string, ModifierView>,
  where: string,
): BodiesPlan {
  const removed = takers(bodies, "modifiers").flatMap((b) => {
    const row = modifierRows(b.page, views).find((r) => r.key === key);
    return row === undefined ? [] : [{ body: b, row }];
  });
  return plan(
    removed.map(({ body, row }): Op => ({
      type: "RemoveBodyModifier",
      body: body.id,
      modifier: row.modifier,
      ...(row.feature ? { feature: row.key } : {}),
    })),
    `Removed ${name} from ${bodiesNoun(removed.map(({ body }) => body))}`,
    where,
    { all: bodies },
  );
}
