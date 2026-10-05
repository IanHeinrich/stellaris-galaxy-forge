import { useEffect } from "react";
import { PREPARE_ROW_CHOICES } from "../../../generated/constants";
import type { PrepareChoice } from "../../../generated/PrepareChoice";
import type { PrepareRow } from "../../../generated/PrepareRow";
import {
  APPLY_LABEL,
  changesLine,
  choiceLabel,
  COUNTING,
  customLine,
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
  leavesOut,
  leftOutRows,
  nearestPreset,
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
function PresetSwitch() {
  const choices = usePrepareStore((s) => s.choices);
  const setPreset = usePrepareStore((s) => s.setPreset);
  const preset = presetOf(choices);
  const nearest = preset === "custom" ? nearestPreset(choices) : null;
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

function ChoiceRow({ row, copy }: { row: PrepareRow; copy: RowCopy }) {
  const choice = usePrepareStore((s) => s.choices[row]);
  const hovered = usePrepareStore((s) => s.hovered === row);
  const count = usePrepareStore((s) =>
    s.preview === null ? null : rowSystems(s.preview, row).length,
  );
  const setChoice = usePrepareStore((s) => s.setChoice);
  const hover = usePrepareStore((s) => s.hover);
  const leaves = usePrepareStore((s) => leavesOut(s, row));
  const offered = PREPARE_ROW_CHOICES[row];
  const consequence = leaves ? copy.consequences[choice] : undefined;
  const filled = (count ?? 0) > 0;
  const keptLine = choice === "keep" && filled ? copy.consequences.keep : undefined;
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
      {consequence !== undefined && <div className="ins-warn prep-note">{consequence}</div>}
      {keptLine !== undefined && <div className="muted prep-note">{keptLine}</div>}
      {filled && copy.note !== undefined && <div className="muted prep-note">{copy.note}</div>}
    </div>
  );
}

/** The rows; the map rings a row's systems while the pointer is on it, and none once they go. */
function ChoiceRows({ copy }: { copy: Record<PrepareRow, RowCopy> }) {
  const hover = usePrepareStore((s) => s.hover);
  useEffect(() => () => hover(null), [hover]);
  return (
    <div className="prep-rows" onPointerLeave={() => hover(null)}>
      {PREPARE_ROWS.map((row) => (
        <ChoiceRow key={row} row={row} copy={copy[row]} />
      ))}
    </div>
  );
}

/** What is left out, how many systems change, and Apply; it stays in view while the rows scroll. */
function Footer({ copy }: { copy: Record<PrepareRow, RowCopy> }) {
  const left = usePrepareStore((s) => leftOutRows(s).join());
  const changes = usePrepareStore((s) => s.preview?.changes ?? null);
  const current = usePrepareStore((s) => s.current);
  const applying = usePrepareStore((s) => s.applying);
  const apply = usePrepareStore((s) => s.apply);
  const rows = left === "" ? [] : (left.split(",") as PrepareRow[]);
  const leftOut = leftOutLine(rows.map((row) => copy[row].label));
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
  const copy = PREPARE_COPY[preview?.profile ?? (paint ? "paint_a_galaxy" : "plain")];
  const summary = summaryLine(presetOf(choices), preview?.changes ?? null, applied);
  return (
    <Section id={PREPARE_SECTION} title={PREPARE_TITLE} aside={summary} startClosed>
      <div className="prep">
        <div className="muted ins-hint">{PREPARE_INTRO}</div>
        <PresetSwitch />
        {!gameData && <div className="muted ins-hint">{PREPARE_NEEDS_GAME_DATA}</div>}
        {gameData && error !== null && <div className="ins-warn">{error}</div>}
        <ChoiceRows copy={copy} />
        <Footer copy={copy} />
      </div>
    </Section>
  );
}
