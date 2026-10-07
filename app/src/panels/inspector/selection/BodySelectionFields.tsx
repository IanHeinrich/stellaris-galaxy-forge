import { useEffect, useMemo, useState } from "react";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { documentCapabilities } from "../../../lib/capabilities";
import {
  addDepositWarnings,
  depositSpread,
  heldModifiers,
  modifierSpread,
  removeDepositWarnings,
  ringSpread,
  selectedBody,
  skipLine,
  spreadLine,
  takers,
  type BodyField,
  type DepositSpread,
  type SelectedBody,
} from "../../../lib/details/bodiesEdit";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import type { PickerTarget } from "../../../lib/details/picker";
import { planetPageOffers } from "../../../lib/details/planetOffers";
import { BLOCKER_ICON, planetDataKeys } from "../../../lib/details/planetPage";
import { counted } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { planetPageKey, useEntityStore } from "../../../store/entityStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { systemLabelOf } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { bodiesEdits, bodiesStale, type BodiesEditAdapter } from "../../../store/planetEditAdapter";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import type { BodySelection } from "../../../store/sceneStore";
import { EditBlock, EditNote, EditRow, ToggleField } from "../../EditField";
import { Icon } from "../../parts";
import { Empty, Section } from "../parts";
import { ConfirmLine } from "../entity/ConfirmLine";
import { DEPOSIT_PICKERS } from "../entity/DepositPicker";
import { MODIFIER_PICKER } from "../entity/ModifierPicker";
import { PlanetClassField } from "../entity/PlanetClassField";
import { DepositRow } from "../entity/PlanetDeposits";
import { ModifierRowView } from "../entity/PlanetModifiers";
import { PlanetPicker } from "../entity/PlanetPicker";
import { SizeField } from "../entity/StarBlock";

export const READING_BODIES = "Reading the selected bodies…";

/** Which part of the page the last edit was made from, so its line shows there. */
type Part = "fields" | "deposits" | "modifiers";

/** The line the last edit left, for the selection and the part it was made from. */
interface Note {
  selection: string;
  part: Part;
  text: string;
}

/** Each selected body's page, asked for while the page is up and again after each edit. */
function usePages(ids: readonly number[]): ReadonlyMap<number, PlanetPage> {
  const request = useEntityStore((s) => s.requestPlanetPage);
  const version = useEntityStore((s) => s.version);
  const pages = useEntityStore((s) => s.pages);
  useEffect(() => {
    for (const id of ids) request(id);
  }, [ids, request, version]);
  return pages;
}

/** Asks for the game data the rows show: every deposit and modifier any of `pages` names. */
function usePlanetData(pages: readonly PlanetPage[]): void {
  const generation = usePlanetDataStore((s) => s.generation);
  useEffect(() => {
    const keys = pages.map(planetDataKeys);
    usePlanetDataStore.getState().request({
      deposits: keys.flatMap((k) => k.deposits),
      modifiers: keys.flatMap((k) => k.modifiers),
      colonyTypes: [],
      anomalies: [],
      digSites: [],
    });
  }, [pages, generation]);
}

/** The selected bodies that read, and the names of those whose page or listing couldn't be read. */
interface ReadBodies {
  bodies: SelectedBody[];
  unread: string[];
}

/**
 * The selected bodies with their pages; `null` while a page is still being read. A body whose page
 * read was refused, or that the system's details don't list, is named in `unread` instead.
 */
function useSelectedBodies(
  selection: BodySelection,
  read: SystemDetails | undefined,
): ReadBodies | null {
  const pages = usePages(selection.ids);
  const errors = useEntityStore((s) => s.errors);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const names = useGameDataStore((s) => s.names);
  const held = useMemo(
    () => selection.ids.flatMap((id) => pages.get(id) ?? []),
    [selection.ids, pages],
  );
  usePlanetData(held);
  return useMemo(() => {
    if (read === undefined) return null;
    const megastructures = new Set(read.megastructures.flatMap((m) => m.planet ?? []));
    const facts = { planetClasses, starClasses, megastructures };
    const bodies: SelectedBody[] = [];
    const unread: string[] = [];
    for (const id of selection.ids) {
      const summary = read.planets.find((p) => p.id === id);
      const page = pages.get(id);
      const name = summary === undefined ? `#${id}` : bodyName(summary, names);
      if (summary !== undefined && page !== undefined) {
        bodies.push(selectedBody(summary, page, name, facts));
      } else if (summary === undefined || errors.has(planetPageKey(id))) {
        unread.push(name);
      } else {
        return null;
      }
    }
    return { bodies, unread };
  }, [selection.ids, read, pages, errors, planetClasses, starClasses, names]);
}

/** Whether an edit has left any selected body's page or the system's details to be read again. */
function useStale(selection: BodySelection): boolean {
  const entityVersion = useEntityStore((s) => s.version);
  const details = useDetailsStore((s) => s.stale);
  return useMemo(
    () => bodiesStale(selection.system, selection.ids),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again whenever either store moves
    [selection, entityVersion, details],
  );
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
  const views = usePlanetDataStore((s) => s.depositTypes);
  const names = useGameDataStore((s) => s.names);
  const { group, holders } = spread;
  const lacking = bodies.length - holders.length;
  const name = group.view?.name ?? group.kind;
  const warnings = removeDepositWarnings(bodies, group.kind, views, names);
  const remove = () => {
    setConfirming(null);
    void edits.removeDeposit(group.kind);
  };
  const actions = (
    <>
      {lacking > 0 && (
        <button
          type="button"
          className="dp-amount"
          title={`Add one ${name} to each body without one`}
          onClick={() => void edits.fillDeposit(group.kind)}
        >
          Add to the other {lacking}
        </button>
      )}
      <button
        type="button"
        className="dp-amount"
        title={`Remove one ${name} from each body that has one`}
        onClick={warnings.length === 0 ? remove : () => setConfirming(group.kind)}
      >
        Remove from {holders.length}
      </button>
    </>
  );
  return (
    <>
      <DepositRow
        group={group}
        station={null}
        removal={null}
        spread={{ line: spreadLine(holders, bodies.length), actions }}
      />
      {confirming && warnings.length > 0 && (
        <ConfirmLine
          className="pl-dep-confirm"
          warnings={warnings}
          confirmLabel="Remove anyway"
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        />
      )}
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
  const names = useGameDataStore((s) => s.names);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { features, blockers } = depositSpread(bodies, views);
  const extra = (key: string) => addDepositWarnings(bodies, key, views, names);
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
  const views = usePlanetDataStore((s) => s.modifiers);
  const planets = takers(bodies, "modifiers");
  const rows = modifierSpread(bodies, views);
  const skipped = skipLine(bodies, "modifiers");
  return (
    <Section id="bodies.modifiers" title="Modifiers" count={rows.length}>
      {rows.map(({ row, holders }) => {
        const lacking = planets.length - holders.length;
        const name = row.view?.name ?? row.key;
        const actions = (
          <>
            {lacking > 0 && (
              <button
                type="button"
                className="dp-amount"
                title={`Add ${name} to each planet without it, for good`}
                onClick={() => void edits.fillModifier(row)}
              >
                Add to the other {lacking}
              </button>
            )}
            <button
              type="button"
              className="dp-amount"
              title={`Remove ${name} from each planet that has it`}
              onClick={() => void edits.removeModifier(row)}
            >
              Remove from {holders.length}
            </button>
          </>
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
 * The planet page's fields for every selected body at once: Size, Class and Ring, then Deposits
 * and Modifiers. Each change is one edit over the bodies that take it, and a line under its part
 * says what it did and skipped until the next one or the selection changes.
 */
export function BodySelectionFields({
  selection,
  read,
}: {
  selection: BodySelection;
  read: SystemDetails | undefined;
}) {
  const answer = useSelectedBodies(selection, read);
  const bodies = answer?.bodies ?? null;
  const failed = useDetailsStore((s) => s.failed.get(selection.system));
  const stale = useStale(selection);
  const [lock] = useState(() => ({ sending: false }));
  const capabilities = useFileSessionStore((s) => documentCapabilities(s));
  const names = useGameDataStore((s) => s.names);
  const depositViews = usePlanetDataStore((s) => s.depositTypes);
  const modifierViews = usePlanetDataStore((s) => s.modifiers);
  const [note, setNote] = useState<Note | null>(null);
  const key = `save:${selection.system}:${selection.ids.join("-")}`;

  const adapters = useMemo(() => {
    if (bodies === null) return null;
    const context = {
      bodies,
      system: selection.system,
      lock,
      where: systemLabelOf(selection.system),
      depositName: (kind: string) => depositViews.get(kind)?.name ?? kind,
      className: (cls: string) => bodyClassName(cls, names),
      modifierViews,
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
  }, [bodies, selection.system, lock, depositViews, modifierViews, names, key]);

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
      spread: takers(bodies, "modifiers").map(heldModifiers),
      edits,
    });
    return { deposits: target(adapters.deposits), modifiers: target(adapters.modifiers) };
  }, [bodies, adapters, key]);

  if (answer === null || bodies === null || adapters === null || targets === null) {
    return <Empty>{read === undefined && failed !== undefined ? failed : READING_BODIES}</Empty>;
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
