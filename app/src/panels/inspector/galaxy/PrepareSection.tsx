import { useEffect } from "react";
import type { PrepareChoice } from "../../../generated/PrepareChoice";
import type { PrepareRow } from "../../../generated/PrepareRow";
import type { ScenarioProfile } from "../../../generated/ScenarioProfile";
import {
  APPLY_LABEL,
  changesLine,
  choiceLabel,
  CLEAR_AROUND_HINT,
  CLEAR_AROUND_LABEL,
  consequence,
  COUNTING,
  customLine,
  cutOffLine,
  keptClearLine,
  leftOutLine,
  NOTHING_TO_CHANGE,
  ONE_STEP,
  PREPARE_COPY,
  PREPARE_INTRO,
  PREPARE_NEEDS_GAME_DATA,
  PREPARE_TITLE,
  PRESET_LABELS,
  rowCount,
  summaryLine,
  type RowCopy,
} from "../../../lib/prepareCopy";
import { usePaintLayer } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import {
  cutOffSeats,
  leavesOut,
  leftOutRows,
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
import { Section } from "../parts";

/** Faithful, Fresh start and Bare shell, and Custom while the choices match none of them. */
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
      {nearest !== null && (
        <div className="muted ins-hint">{customLine(nearest.preset, nearest.rows)}</div>
      )}
    </>
  );
}

/** Keep the space around capitals clear, and how many systems it turns into ordinary stars. */
function ClearAroundSeats() {
  const on = usePrepareStore((s) => s.options.clear_around_seats);
  const kept = usePrepareStore((s) => s.preview?.kept_clear.length ?? 0);
  const setClearAroundSeats = usePrepareStore((s) => s.setClearAroundSeats);
  return (
    <div className="prep-option">
      <label>
        <input type="checkbox" checked={on} onChange={() => setClearAroundSeats(!on)} />
        <span>{CLEAR_AROUND_LABEL}</span>
      </label>
      <div className="muted prep-note">
        {on && kept > 0 ? keptClearLine(kept) : CLEAR_AROUND_HINT}
      </div>
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
}: {
  row: PrepareRow;
  copy: RowCopy;
  profile: ScenarioProfile;
}) {
  const choice = usePrepareStore((s) => s.choices[row]);
  const hovered = usePrepareStore((s) => s.hovered === row);
  const count = usePrepareStore((s) =>
    s.preview === null ? null : rowSystems(s.preview, row).length,
  );
  const setChoice = usePrepareStore((s) => s.setChoice);
  const hover = usePrepareStore((s) => s.hover);
  const leaves = usePrepareStore((s) => leavesOut(s, row));
  const clearAround = usePrepareStore((s) => s.options.clear_around_seats);
  const offered = offeredChoices(row, profile);
  const warning = leaves ? consequence(copy, choice, clearAround) : undefined;
  const filled = (count ?? 0) > 0;
  const keptLine = choice === "keep" && filled ? copy.consequences.keep : undefined;
  if (row === "sol" && !filled) return null;
  return (
    <div className={`prep-row${hovered ? " hovered" : ""}`} onPointerEnter={() => hover(row)}>
      <div className="prep-row-name">
        <span>{copy.label}</span>
        {count !== null && <span className="muted">{rowCount(copy, count)}</span>}
      </div>
      <PickerField
        label={`${copy.label} choice`}
        current={{ key: choice, label: choiceLabel(copy, choice) }}
        items={offered.map((key) => ({ key, label: choiceLabel(copy, key) }))}
        onPick={(key) => {
          const picked = offered.find((offer: PrepareChoice) => offer === key);
          if (picked !== undefined) setChoice(row, picked);
        }}
      />
      {warning !== undefined && <div className="ins-warn prep-note">{warning}</div>}
      {row === "wormhole_pairs" && choice !== "keep" && <CutOffNote />}
      {keptLine !== undefined && <div className="muted prep-note">{keptLine}</div>}
      {filled && copy.note !== undefined && <div className="muted prep-note">{copy.note}</div>}
    </div>
  );
}

/** The rows; the map rings a row's systems while the pointer is on it, and none once they go. */
function ChoiceRows({
  copy,
  profile,
}: {
  copy: Record<PrepareRow, RowCopy>;
  profile: ScenarioProfile;
}) {
  const hover = usePrepareStore((s) => s.hover);
  useEffect(() => () => hover(null), [hover]);
  return (
    <div className="prep-rows" onPointerLeave={() => hover(null)}>
      {PREPARE_ROWS.map((row) => (
        <ChoiceRow key={row} row={row} copy={copy[row]} profile={profile} />
      ))}
    </div>
  );
}

/** What is left out, how many systems change, and Apply; it stays in view while the rows scroll. */
function Footer({ copy }: { copy: Record<PrepareRow, RowCopy> }) {
  const left = usePrepareStore((s) => leftOutRows(s).join());
  const cutOff = usePrepareStore((s) => s.preview?.cut_off.length ?? 0);
  const changes = usePrepareStore((s) => s.preview?.changes ?? null);
  const current = usePrepareStore((s) => s.current);
  const applying = usePrepareStore((s) => s.applying);
  const apply = usePrepareStore((s) => s.apply);
  const rows = left === "" ? [] : (left.split(",") as PrepareRow[]);
  const leftOut = leftOutLine(
    rows.map((row) => copy[row].label),
    cutOff,
  );
  return (
    <div className="prep-footer">
      {leftOut !== null && <div className="ins-warn">{leftOut}</div>}
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

/** Prepare for a new game: a preset or a choice per row, applied to the scenario as one edit. */
export function PrepareSection() {
  const choices = usePrepareStore((s) => s.choices);
  const preview = usePrepareStore((s) => s.preview);
  const error = usePrepareStore((s) => s.error);
  const applied = usePrepareStore((s) => s.applied);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const paint = usePaintLayer();
  const profile = preview?.profile ?? (paint ? "paint_a_galaxy" : "plain");
  const copy = PREPARE_COPY[profile];
  const summary = summaryLine(presetOf(choices, profile), preview?.changes ?? null, applied);
  return (
    <Section id={PREPARE_SECTION} title={PREPARE_TITLE} aside={summary} startClosed>
      <div className="prep">
        <div className="muted ins-hint">{PREPARE_INTRO}</div>
        <PresetSwitch profile={profile} />
        <ClearAroundSeats />
        {!gameData && <div className="muted ins-hint">{PREPARE_NEEDS_GAME_DATA}</div>}
        {gameData && error !== null && <div className="ins-warn">{error}</div>}
        <ChoiceRows copy={copy} profile={profile} />
        <Footer copy={copy} />
      </div>
    </Section>
  );
}
