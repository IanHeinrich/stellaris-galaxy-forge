import { useMemo, useState, type ReactNode } from "react";
import type { DocumentKind } from "../../../generated/DocumentKind";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { documentCapabilities } from "../../../lib/capabilities";
import {
  addDepositWarnings,
  depositSpread,
  modifierSpread,
  removeDepositWarnings,
  ringSpread,
  skipLine,
  spreadLine,
  takers,
  type BodyField,
  type DepositSpread,
  type SelectedBody,
} from "../../../lib/details/bodiesEdit";
import { bodyClassName } from "../../../lib/details/labels";
import type { PickerTarget } from "../../../lib/details/picker";
import { planetPageOffers } from "../../../lib/details/planetOffers";
import { BLOCKER_ICON } from "../../../lib/details/planetPage";
import { counted } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { systemLabelOf } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodiesEdits, type BodiesEditAdapter } from "../../../store/planetEditAdapter";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import type { BodySelection } from "../../../store/sceneStore";
import { EditBlock, EditNote, EditRow, ToggleField } from "../../EditField";
import { Icon } from "../../parts";
import { Empty, Section } from "../parts";
import { BODY_SOURCES, type BodyAnswer, type BodySource } from "../entity/bodySources";
import { DEPOSIT_PICKERS } from "../entity/DepositPicker";
import { MODIFIER_PICKER } from "../entity/ModifierPicker";
import { PlanetClassField } from "../entity/PlanetClassField";
import { DepositRow, RemovalConfirm } from "../entity/PlanetDeposits";
import { ModifierRowView } from "../entity/PlanetModifiers";
import { PlanetPicker } from "../entity/PlanetPicker";
import { SpreadActions } from "../entity/RowParts";
import { SizeField } from "../entity/StarBlock";
import {
  useSelectedBodies,
  useSelectionListing,
  useStale,
  type ListedBody,
  type SelectionListing,
} from "./useSelectedBodies";

export const READING_BODIES = "Reading the selected bodies…";

/** Which part of the page the last edit was made from, so its line shows there. */
type Part = "fields" | "deposits" | "modifiers";

/** The line the last edit left, for the selection and the part it was made from. */
interface Note {
  selection: string;
  part: Part;
  text: string;
}

/** What `field` leaves out, under the field. */
function SkipNote({ bodies, field }: { bodies: readonly SelectedBody[]; field: BodyField }) {
  const line = skipLine(bodies, field);
  return line === null ? null : <EditNote title={line.title}>{line.text}</EditNote>;
}

/** The size the bodies share, or their range. */
function sizeRange(bodies: readonly SelectedBody[]): { min: number; max: number } | null {
  const sizes = bodies.flatMap((b) => b.summary.size ?? []);
  return sizes.length === 0 ? null : { min: Math.min(...sizes), max: Math.max(...sizes) };
}

/** The Size field's hover text: a colony among the bodies is warned about its districts. */
function sizeTitle(bodies: readonly SelectedBody[]): string {
  const colonies = bodies.filter((b) => b.summary.colonised).map((b) => b.name);
  const title = "Change the size of every selected body.";
  return colonies.length === 0
    ? title
    : `${title} Within a month the game demolishes districts over a lowered cap on ${colonies.join(", ")}.`;
}

/** "Ring · 1 of 4 has one". */
function ringLabel(has: number, of: number): string {
  return `Ring · ${has} of ${of} ${has === 1 ? "has" : "have"} one`;
}

/** Size, Class and Ring for every selected body that takes each; each leaves itself out where none does. */
function FieldsBlock({
  bodies,
  edits,
  offers,
}: {
  bodies: readonly SelectedBody[];
  edits: BodiesEditAdapter;
  offers: { size: boolean; class: boolean; ring: boolean };
}) {
  const sized = offers.size ? takers(bodies, "size") : [];
  const classed = offers.class ? takers(bodies, "class") : [];
  const ring = offers.ring ? ringSpread(bodies) : { has: 0, of: 0 };
  const size = sizeRange(sized);
  if (size === null && classed.length === 0 && ring.of === 0) return null;
  return (
    <EditBlock title="All selected">
      {size !== null && (
        <>
          <EditRow label="Size">
            <SizeField
              edits={edits}
              size={size}
              mixed={size.min !== size.max}
              title={sizeTitle(sized)}
            />
          </EditRow>
          <SkipNote bodies={bodies} field="size" />
        </>
      )}
      {classed.length > 0 && (
        <>
          <PlanetClassField
            bodies={classed.map((b) => ({
              id: b.id,
              name: b.name,
              class: b.summary.class,
              colonised: b.summary.colonised,
              moon: b.summary.moon,
            }))}
            edits={edits}
          />
          <SkipNote bodies={bodies} field="class" />
        </>
      )}
      {ring.of > 0 && (
        <>
          <ToggleField
            label={ringLabel(ring.has, ring.of)}
            title="Draws a ring around each selected planet"
            checked={ring.has === ring.of}
            mixed={ring.has > 0 && ring.has < ring.of}
            onChange={(on) => void edits.setRing(on)}
          />
          <SkipNote bodies={bodies} field="ring" />
        </>
      )}
    </EditBlock>
  );
}

/** One deposit type's row: who has it, Add to the others and Remove, with the confirm a removal may need. */
function SpreadDepositRow({
  bodies,
  spread,
  edits,
  confirming,
  setConfirming,
}: {
  bodies: readonly SelectedBody[];
  spread: DepositSpread;
  edits: BodiesEditAdapter;
  confirming: boolean;
  setConfirming: (kind: string | null) => void;
}) {
  const { group, holders } = spread;
  const lacking = bodies.length - holders.length;
  const name = group.view?.name ?? group.kind;
  const warnings = removeDepositWarnings(bodies, group.kind);
  const remove = () => {
    setConfirming(null);
    void edits.removeDeposit(group.kind);
  };
  const actions = (
    <SpreadActions
      lacking={lacking}
      holders={holders.length}
      addTitle={`Add one ${name} to each body without one`}
      removeTitle={`Remove one ${name} from each body that has one`}
      onAdd={() => void edits.fillDeposit(group.kind)}
      onRemove={warnings.length === 0 ? remove : () => setConfirming(group.kind)}
    />
  );
  return (
    <>
      <DepositRow
        group={group}
        station={null}
        removal={null}
        spread={{ line: spreadLine(holders, bodies.length), actions }}
      />
      <RemovalConfirm
        removal={{
          warnings,
          confirming: confirming && warnings.length > 0,
          confirm: remove,
          cancel: () => setConfirming(null),
        }}
      />
    </>
  );
}

/** Every deposit type on any selected body, the blockers apart, and the pickers that add one to each body. */
function DepositsSection({
  bodies,
  edits,
  target,
  note,
}: {
  bodies: readonly SelectedBody[];
  edits: BodiesEditAdapter;
  target: PickerTarget;
  note: string | null;
}) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { features, blockers } = depositSpread(bodies, views);
  const extra = (key: string) => addDepositWarnings(bodies, key);
  const row = (spread: DepositSpread) => (
    <SpreadDepositRow
      key={spread.group.kind}
      bodies={bodies}
      spread={spread}
      edits={edits}
      confirming={confirming === spread.group.kind}
      setConfirming={setConfirming}
    />
  );
  const summary = [
    counted(features.length, "type"),
    ...(blockers.length > 0 ? [counted(blockers.length, "blocker")] : []),
  ].join(" · ");
  return (
    <Section id="bodies.deposits" title="Deposits" summary={summary}>
      {features.map(row)}
      <PlanetPicker kind={DEPOSIT_PICKERS.deposits} target={target} extra={extra} />
      <div className="pl-sub-head">
        <Icon className="gi" keys={[BLOCKER_ICON]} glyph="" />
        Blockers · {blockers.length}
      </div>
      {blockers.map(row)}
      <PlanetPicker kind={DEPOSIT_PICKERS.blockers} target={target} extra={extra} />
      {note !== null && <div className="muted ins-hint">{note}</div>}
    </Section>
  );
}

/** Every modifier and planet feature on any selected planet, and the picker that adds one to each. */
function ModifiersSection({
  bodies,
  edits,
  target,
  note,
}: {
  bodies: readonly SelectedBody[];
  edits: BodiesEditAdapter;
  target: PickerTarget;
  note: string | null;
}) {
  const planets = takers(bodies, "modifiers");
  const rows = modifierSpread(bodies);
  const skipped = skipLine(bodies, "modifiers");
  return (
    <Section id="bodies.modifiers" title="Modifiers" count={rows.length}>
      {rows.map(({ row, holders }) => {
        const lacking = planets.length - holders.length;
        const name = row.view?.name ?? row.key;
        const actions = (
          <SpreadActions
            lacking={lacking}
            holders={holders.length}
            addTitle={`Add ${name} to each planet without it, for good`}
            removeTitle={`Remove ${name} from each planet that has it`}
            onAdd={() => void edits.fillModifier(row)}
            onRemove={() => void edits.removeModifier(row)}
          />
        );
        return (
          <ModifierRowView
            key={row.key}
            row={row}
            onRemove={null}
            spread={{ line: spreadLine(holders, planets.length), actions }}
          />
        );
      })}
      <PlanetPicker kind={MODIFIER_PICKER} target={target} />
      {skipped !== null && (
        <div className="muted ins-hint" title={skipped.title}>
          {skipped.text}
        </div>
      )}
      {note !== null && <div className="muted ins-hint">{note}</div>}
    </Section>
  );
}

/**
 * Reads `bodies` from `at` on through `source`, one body to a level so each level calls its
 * source's hooks once, and hands every answer to `children`.
 */
function BodyReads({
  source,
  system,
  bodies,
  at,
  answers,
  children,
}: {
  source: BodySource;
  system: number;
  bodies: readonly ListedBody[];
  at: number;
  answers: readonly BodyAnswer[];
  children: (answers: readonly BodyAnswer[]) => ReactNode;
}) {
  const { id, listed } = bodies[at];
  const read = [...answers, source.useRead(system, id, listed)];
  if (at + 1 === bodies.length) return children(read);
  return (
    <BodyReads source={source} system={system} bodies={bodies} at={at + 1} answers={read}>
      {children}
    </BodyReads>
  );
}

/**
 * The planet page's fields for every selected body at once: Size, Class and Ring, then Deposits
 * and Modifiers, each body read through the source of the document's kind. Each change is one
 * edit over the bodies that take it, and a line under its part says what it did and skipped until
 * the next one or the selection changes.
 */
export function BodySelectionFields({
  kind,
  selection,
  read,
}: {
  kind: DocumentKind;
  selection: BodySelection;
  read: SystemDetails | undefined;
}) {
  const listing = useSelectionListing(selection, read);
  const failed = useDetailsStore((s) => s.failed.get(selection.system));
  // Held here: the fields below remount whenever the selection's size changes.
  const [lock] = useState(() => ({ sending: false }));
  const [note, setNote] = useState<Note | null>(null);
  if (listing === null || read === undefined) {
    return <Empty>{read === undefined && failed !== undefined ? failed : READING_BODIES}</Empty>;
  }
  const fields = (answers: readonly BodyAnswer[]) => (
    <SelectedFields
      kind={kind}
      selection={selection}
      read={read}
      listing={listing}
      answers={answers}
      lock={lock}
      note={note}
      setNote={setNote}
    />
  );
  if (listing.listed.length === 0) return fields([]);
  return (
    <BodyReads
      source={BODY_SOURCES[kind]}
      system={selection.system}
      bodies={listing.listed}
      at={0}
      answers={[]}
    >
      {fields}
    </BodyReads>
  );
}

/** The fields of `BodySelectionFields`, once its bodies' sources have answered `answers`. */
function SelectedFields({
  kind,
  selection,
  read,
  listing,
  answers,
  lock,
  note,
  setNote,
}: {
  kind: DocumentKind;
  selection: BodySelection;
  read: SystemDetails;
  listing: SelectionListing;
  answers: readonly BodyAnswer[];
  /** Held while one of the edits is out, so a second click sends nothing. */
  lock: { sending: boolean };
  note: Note | null;
  setNote(note: Note | null): void;
}) {
  const answer = useSelectedBodies(listing, answers, read);
  const bodies = answer?.bodies ?? null;
  const stale = useStale(selection);
  const capabilities = useFileSessionStore((s) => documentCapabilities(s));
  const names = useGameDataStore((s) => s.names);
  const depositViews = usePlanetDataStore((s) => s.depositTypes);
  const key = `${kind}:${selection.system}:${selection.ids.join("-")}`;

  const adapters = useMemo(() => {
    if (bodies === null) return null;
    const context = {
      kind,
      bodies,
      system: selection.system,
      lock,
      where: systemLabelOf(selection.system),
      depositName: (deposit: string) => depositViews.get(deposit)?.name ?? deposit,
      className: (cls: string) => bodyClassName(cls, names),
    };
    const reporting = (part: Part) =>
      bodiesEdits(context, (text) =>
        setNote(text === null ? null : { selection: key, part, text }),
      );
    return {
      fields: reporting("fields"),
      deposits: reporting("deposits"),
      modifiers: reporting("modifiers"),
    };
  }, [kind, bodies, selection.system, lock, depositViews, names, key, setNote]);

  const targets = useMemo(() => {
    if (bodies === null || adapters === null) return null;
    const classes = new Set(bodies.map((b) => b.summary.class));
    const target = (edits: BodiesEditAdapter): PickerTarget => ({
      key,
      planetClass: classes.size === 1 ? [...classes][0] : null,
      size: null,
      moon: false,
      deposits: [],
      modifiers: [],
      anomaly: null,
      spread: takers(bodies, "modifiers").map((b) => b.held.modifiers),
      edits,
    });
    return { deposits: target(adapters.deposits), modifiers: target(adapters.modifiers) };
  }, [bodies, adapters, key]);

  if (answer === null || bodies === null || adapters === null || targets === null) {
    return <Empty>{READING_BODIES}</Empty>;
  }
  const unread =
    answer.unread.length === 0 ? null : (
      <div className="muted ins-hint">
        Leaves out {answer.unread.join(", ")}, whose {answer.unread.length === 1 ? "page" : "pages"}{" "}
        couldn't be read.
      </div>
    );
  if (answer.bodies.length === 0) return unread;
  const offers = planetPageOffers(capabilities, { star: false, ringable: true, moonHost: false });
  const noteOn = (part: Part) =>
    note !== null && note.selection === key && note.part === part ? note.text : null;
  const fieldsNote = noteOn("fields");
  return (
    <fieldset className="ins-fields" disabled={stale}>
      {unread}
      <FieldsBlock
        bodies={bodies}
        edits={adapters.fields}
        offers={{ size: capabilities.bodies, class: offers.planetClass, ring: offers.ring }}
      />
      {fieldsNote !== null && <div className="muted ins-hint">{fieldsNote}</div>}
      {offers.deposits && (
        <DepositsSection
          bodies={bodies}
          edits={adapters.deposits}
          target={targets.deposits}
          note={noteOn("deposits")}
        />
      )}
      {offers.modifiers && takers(bodies, "modifiers").length > 0 && (
        <ModifiersSection
          bodies={bodies}
          edits={adapters.modifiers}
          target={targets.modifiers}
          note={noteOn("modifiers")}
        />
      )}
    </fieldset>
  );
}
