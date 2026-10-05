import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PrepareChoice } from "../../../generated/PrepareChoice";
import type { PreparePreset } from "../../../generated/PreparePreset";
import type { PrepareRow } from "../../../generated/PrepareRow";
import type { ScenarioProfile } from "../../../generated/ScenarioProfile";
import {
  APPLY_LABEL,
  changesLine,
  choiceLabel,
  CLEAR_AROUND_LABEL,
  COUNTING,
  CURRENT_MARK,
  customLine,
  cutOffLine,
  FAITHFUL_PLAIN,
  KEPT_CLEAR,
  lineText,
  NOT_KEPT_CLEAR,
  NOT_NOW_LABEL,
  NOTHING_TO_CHANGE,
  ONE_STEP,
  PREPARE_COPY,
  PREPARE_INTRO,
  PREPARE_NEEDS_GAME_DATA,
  PREPARE_TITLE,
  PRESET_ANSWERS,
  PLACER_LABELS,
  PRESET_LABELS,
  REROLL_HINT,
  REROLL_LABEL,
  rowCount,
  rowDisabledReason,
  ROWS_LABEL,
  summaryLine,
  type Answers,
  type Placer,
  type RowCopy,
} from "../../../lib/prepareCopy";
import { usePaintLayer } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import {
  cutOffSeats,
  draws,
  nearestPreset,
  offeredChoices,
  PREPARE_PRESET_NAMES,
  PREPARE_ROWS,
  PREPARE_SECTION,
  presetOf,
  rowSystems,
  usePrepareStore,
} from "../../../store/prepareStore";
import { PickerField } from "../../EditField";
import { Twisty } from "../../Twisty";
import { PickerCard, type CardItem } from "../entity/PickerCard";
import { Section } from "../parts";

/** The list item the pointer or the arrows are on in a row's open picker. */
interface ActiveItem {
  row: PrepareRow;
  choice: PrepareChoice;
}

/** The DOM id of `row`'s line, which its card stands level with. */
function prepRowId(row: PrepareRow): string {
  return `prep-row-${row}`;
}

const CARD_ID = "prep-card";

/** Who places what a choice leaves in the new game, as a small chip in that placer's colour. */
function Tag({ placer }: { placer: Placer }) {
  return <span className={`prep-tag ${placer}`}>{PLACER_LABELS[placer]}</span>;
}

/** A choice's tag, then its sentences. */
function ChoiceLine({ answers, n }: { answers: Answers; n: number | null }) {
  return (
    <div className="prep-choice-line">
      <Tag placer={answers.placer} /> {lineText(answers.text, n)}
    </div>
  );
}

/** The three presets, and Custom while the choices match none of them. */
function PresetSwitch({ profile }: { profile: ScenarioProfile }) {
  const choices = usePrepareStore((s) => s.choices);
  const setPreset = usePrepareStore((s) => s.setPreset);
  const preset = presetOf(choices, profile);
  const nearest = preset === "custom" ? nearestPreset(choices, profile) : null;
  return (
    <>
      <div className="segmented prep-presets" role="group" aria-label="Preset">
        {PREPARE_PRESET_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={preset === name}
            onClick={() => setPreset(name)}
          >
            {PRESET_LABELS[name]}
          </button>
        ))}
        {preset === "custom" && (
          <button type="button" aria-pressed disabled>
            {PRESET_LABELS.custom}
          </button>
        )}
      </div>
      {nearest !== null ? (
        <div className="muted ins-hint">{customLine(nearest.preset, nearest.rows)}</div>
      ) : (
        <PresetAnswers preset={preset as PreparePreset} profile={profile} />
      )}
    </>
  );
}

/** What the chosen preset does, and on a plain map that it brings no fallen empires. */
function PresetAnswers({ preset, profile }: { preset: PreparePreset; profile: ScenarioProfile }) {
  return (
    <div className="prep-preset">
      <div className="prep-choice-line">{PRESET_ANSWERS[preset]}</div>
      {preset === "faithful" && profile === "plain" && (
        <div className="muted">{FAITHFUL_PLAIN}</div>
      )}
    </div>
  );
}

/**
 * Keep threats away from starting positions: while on, how many systems it turns into normal
 * systems, ringed on hover; while off, the warning.
 */
function ClearAroundSeats() {
  const on = usePrepareStore((s) => s.options.clear_around_seats);
  const kept = usePrepareStore((s) => s.preview?.kept_clear.length ?? null);
  const setClearAroundSeats = usePrepareStore((s) => s.setClearAroundSeats);
  const hover = usePrepareStore((s) => s.hover);
  return (
    <div
      className="prep-option"
      onPointerEnter={() => hover("clear_around")}
      onPointerLeave={() => hover(null)}
    >
      <label>
        <input type="checkbox" checked={on} onChange={() => setClearAroundSeats(!on)} />
        <span>{CLEAR_AROUND_LABEL}</span>
      </label>
      {on && kept !== 0 && (
        <div className="muted prep-note">
          <ChoiceLine answers={KEPT_CLEAR} n={kept} />
        </div>
      )}
      {!on && (
        <div className="ins-warn prep-note">
          <ChoiceLine answers={NOT_KEPT_CLEAR} n={null} />
        </div>
      )}
    </div>
  );
}

/** Reroll, while a row takes a choice Forge draws. */
function Reroll() {
  const shown = usePrepareStore((s) => draws(s.choices));
  const reroll = usePrepareStore((s) => s.reroll);
  if (!shown) return null;
  return (
    <div className="prep-reroll">
      <button type="button" onClick={() => reroll()}>
        {REROLL_LABEL}
      </button>
      <span className="muted">{REROLL_HINT}</span>
    </div>
  );
}

/** The warning under Wormhole pairs while taking them out cuts systems off. */
function CutOffNote() {
  const systems = usePrepareStore((s) => s.preview?.cut_off.length ?? 0);
  const seats = usePrepareStore((s) => cutOffSeats(s.preview));
  if (systems === 0) return null;
  return <div className="ins-warn prep-note">{cutOffLine(systems, seats)}</div>;
}

function ChoiceRow({
  row,
  copy,
  profile,
  onActive,
}: {
  row: PrepareRow;
  copy: RowCopy;
  profile: ScenarioProfile;
  onActive: (row: PrepareRow, choice: PrepareChoice | null) => void;
}) {
  const choice = usePrepareStore((s) => s.choices[row]);
  const hovered = usePrepareStore((s) => s.hovered === row);
  const count = usePrepareStore((s) =>
    s.preview === null ? null : rowSystems(s.preview, row).length,
  );
  const setChoice = usePrepareStore((s) => s.setChoice);
  const hover = usePrepareStore((s) => s.hover);
  const offered = offeredChoices(row, profile);
  const answers = (count ?? 0) > 0 ? copy.answers[choice] : undefined;
  if (row === "sol" && (count ?? 0) === 0) return null;
  const pick = (key: string | null) => offered.find((offer) => offer === key) ?? null;
  return (
    <div
      id={prepRowId(row)}
      className={`prep-row${hovered ? " hovered" : ""}`}
      onPointerEnter={() => hover(row)}
    >
      <div className="prep-row-name">
        <span>{copy.label}</span>
        {count !== null && <span className="muted">{rowCount(copy, count)}</span>}
      </div>
      <PickerField
        label={`${copy.label} choice`}
        current={{ key: choice, label: choiceLabel(copy, choice) }}
        items={offered.map((key) => {
          const offer = copy.answers[key];
          return {
            key,
            label: choiceLabel(copy, key),
            note: offer === undefined ? undefined : <ChoiceLine answers={offer} n={count} />,
          };
        })}
        disabledReason={rowDisabledReason(row, profile)}
        onActive={(key) => onActive(row, pick(key))}
        onPick={(key) => {
          const picked = pick(key);
          if (picked !== null) setChoice(row, picked);
        }}
      />
      {answers !== undefined && (
        <div className="muted prep-note">
          <ChoiceLine answers={answers} n={count} />
        </div>
      )}
      {row === "wormhole_pairs" && choice !== "keep" && <CutOffNote />}
    </div>
  );
}

/**
 * The hovered row's card, beside the dock: what the row holds, then each choice it offers with
 * its tag and sentences and the current one marked; while its list is open, the item the list is on.
 */
function RowCard({
  row,
  copy,
  profile,
  active,
}: {
  row: PrepareRow;
  copy: RowCopy;
  profile: ScenarioProfile;
  active: PrepareChoice | null;
}) {
  const choice = usePrepareStore((s) => s.choices[row]);
  const count = usePrepareStore((s) =>
    s.preview === null ? null : rowSystems(s.preview, row).length,
  );
  const item = useMemo<CardItem>(
    () => ({ label: copy.label, category: copy.holds, effects: [] }),
    [copy],
  );
  const reason = rowDisabledReason(row, profile);
  const shown =
    reason !== undefined ? [] : active !== null ? [active] : offeredChoices(row, profile);
  return (
    <PickerCard
      key={`${row}:${active}:${choice}:${count}`}
      id={CARD_ID}
      item={item}
      rowId={prepRowId(row)}
    >
      {reason !== undefined && <span className="dp-card-note muted">{reason}</span>}
      {shown.map((offer) => {
        const answers = copy.answers[offer];
        if (answers === undefined) return null;
        return (
          <div key={offer} className={`prep-card-choice${offer === choice ? " current" : ""}`}>
            <span className="prep-card-choice-name">
              {choiceLabel(copy, offer)}
              {offer === choice && <span className="muted"> · {CURRENT_MARK}</span>}
            </span>
            <ChoiceLine answers={answers} n={count} />
          </div>
        );
      })}
    </PickerCard>
  );
}

/** The fourteen rows; the map rings a row's systems on hover, and none once they go. */
function ChoiceRows({
  copy,
  profile,
  onActive,
}: {
  copy: Record<PrepareRow, RowCopy>;
  profile: ScenarioProfile;
  onActive: (row: PrepareRow, choice: PrepareChoice | null) => void;
}) {
  const hover = usePrepareStore((s) => s.hover);
  useEffect(() => () => hover(null), [hover]);
  return (
    <div className="prep-rows" onPointerLeave={() => hover(null)}>
      {PREPARE_ROWS.map((row) => (
        <ChoiceRow key={row} row={row} copy={copy[row]} profile={profile} onActive={onActive} />
      ))}
    </div>
  );
}

/** Row by row: open for each document until the player folds it. */
function RowByRow({
  copy,
  profile,
  onActive,
}: {
  copy: Record<PrepareRow, RowCopy>;
  profile: ScenarioProfile;
  onActive: (row: PrepareRow, choice: PrepareChoice | null) => void;
}) {
  const open = usePrepareStore((s) => s.rowsOpen);
  const setRowsOpen = usePrepareStore((s) => s.setRowsOpen);
  return (
    <>
      <button
        type="button"
        className="prep-disclosure"
        aria-expanded={open}
        onClick={() => setRowsOpen(!open)}
      >
        <Twisty open={open} />
        {ROWS_LABEL}
      </button>
      {open && <ChoiceRows copy={copy} profile={profile} onActive={onActive} />}
    </>
  );
}

/** How many systems Apply changes, and Apply; on the setup screen, Not now besides. */
function Footer({ setup }: { setup: boolean }) {
  const changes = usePrepareStore((s) => s.preview?.changes ?? null);
  const current = usePrepareStore((s) => s.current);
  const applying = usePrepareStore((s) => s.applying);
  const apply = usePrepareStore((s) => s.apply);
  const dismiss = usePrepareStore((s) => s.dismiss);
  return (
    <div className="prep-footer">
      <div className="prep-apply">
        <span className="muted">
          {changes === null
            ? ""
            : !current
              ? COUNTING
              : changes === 0
                ? NOTHING_TO_CHANGE
                : `${changesLine(changes)} ${ONE_STEP}`}
        </span>
        {setup && (
          <button type="button" className="link" onClick={() => dismiss()}>
            {NOT_NOW_LABEL}
          </button>
        )}
        <button
          type="button"
          disabled={applying || !current || changes === null || changes === 0}
          onClick={() => void apply()}
        >
          {APPLY_LABEL}
        </button>
      </div>
    </div>
  );
}

/**
 * Everything above the footer, in the box the card stands beside: the preset and what it gives,
 * the option around capitals, Reroll, and the rows. `footer` closes it where it scrolls with the
 * rows.
 */
function PrepareBody({ profile, footer }: { profile: ScenarioProfile; footer?: ReactNode }) {
  const error = usePrepareStore((s) => s.error);
  const hovered = usePrepareStore((s) => s.hovered);
  const rowsOpen = usePrepareStore((s) => s.rowsOpen);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const [active, setActive] = useState<ActiveItem | null>(null);
  const onActive = useCallback((row: PrepareRow, choice: PrepareChoice | null) => {
    setActive((was) => {
      if (choice === null) return was?.row === row ? null : was;
      return was?.row === row && was.choice === choice ? was : { row, choice };
    });
  }, []);
  const copy = PREPARE_COPY[profile];
  const cardRow = rowsOpen && hovered !== null && hovered !== "clear_around" ? hovered : null;
  return (
    <div className="prep">
      <div className="muted ins-hint">{PREPARE_INTRO}</div>
      <PresetSwitch profile={profile} />
      <ClearAroundSeats />
      <Reroll />
      {!gameData && <div className="muted ins-hint">{PREPARE_NEEDS_GAME_DATA}</div>}
      {gameData && error !== null && <div className="ins-warn">{error}</div>}
      <RowByRow copy={copy} profile={profile} onActive={onActive} />
      {cardRow !== null && (
        <RowCard
          row={cardRow}
          copy={copy[cardRow]}
          profile={profile}
          active={active?.row === cardRow ? active.choice : null}
        />
      )}
      {footer}
    </div>
  );
}

/** The profile the section words its rows for: the preview's, else the open document's. */
function useProfile(): ScenarioProfile {
  const previewed = usePrepareStore((s) => s.preview?.profile ?? null);
  const paint = usePaintLayer();
  return previewed ?? (paint ? "paint_a_galaxy" : "plain");
}

/**
 * Prepare for a new game: a preset or a choice per row, applied to the scenario as one edit. On
 * the setup screen it is the whole page, its rows scrolling over a footer that stays put.
 */
export function PrepareSection({ setup = false }: { setup?: boolean }) {
  const choices = usePrepareStore((s) => s.choices);
  const pending = usePrepareStore((s) => s.preview?.changes ?? null);
  const applied = usePrepareStore((s) => s.applied);
  const profile = useProfile();
  if (setup) {
    return (
      <>
        <div className="prep-setup-title">{PREPARE_TITLE}</div>
        <PrepareBody profile={profile} />
        <Footer setup />
      </>
    );
  }
  const summary = summaryLine(presetOf(choices, profile), pending, applied);
  return (
    <Section id={PREPARE_SECTION} title={PREPARE_TITLE} aside={summary} startClosed>
      <PrepareBody profile={profile} footer={<Footer setup={false} />} />
    </Section>
  );
}
