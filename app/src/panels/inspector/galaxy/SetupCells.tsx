import { useState } from "react";
import type { Op } from "../../../generated/Op";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { ENTER, ESCAPE } from "../../keys";
import {
  CLEAR_KEY_TITLE,
  CLEAR_RANGE_TITLE,
  RAW_CELL_TITLE,
  setBound,
  setScalar,
  type RangeReading,
  type Reading,
  type SetupView,
} from "./gameSetup";
import { removeHeaderField } from "./header";

/**
 * A count the grid edits: empty until the key exists, committed on Enter or blur, Escape restores.
 * Clearing a cell whose key exists drops the key; a value the key cannot hold is put back.
 */
function NumberCell({
  label,
  title,
  value,
  decimals,
  onCommit,
}: {
  label: string;
  title: string;
  value: number | null;
  decimals: boolean;
  /** Null once the cell was cleared. */
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === null ? "" : String(value);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft === shown) return;
    if (draft.trim() === "") {
      if (shown !== "") onCommit(null);
      return;
    }
    const n = Number(draft);
    if (Number.isFinite(n)) onCommit(n);
  };
  return (
    <input
      type="number"
      step={decimals ? 0.1 : 1}
      className="ins-setup-cell"
      aria-label={label}
      placeholder="–"
      value={draft ?? shown}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === ENTER) e.currentTarget.blur();
        else if (e.key === ESCAPE) setDraft(null);
      }}
    />
  );
}

/** Text the grid cannot read as a number, left to the raw list below. */
function RawCell({ text, wide }: { text: string; wide?: boolean }) {
  return (
    <span className={`ins-setup-cell raw mono muted${wide ? " wide" : ""}`} title={RAW_CELL_TITLE}>
      {text}
    </span>
  );
}

/** What the header holds at the moment a cell commits, not when it was drawn. */
const currentHeader = () => useGalaxyStore.getState().header;

/** A plain-number key's cell: blank where the row has no such key. */
export function ScalarCell({
  label,
  keyName,
  reading,
  decimals,
  applyOp,
}: {
  label: string;
  keyName: string | undefined;
  reading: Reading | null;
  decimals: boolean;
  applyOp: (op: Op) => void;
}) {
  if (keyName === undefined || reading === null) return <span />;
  if (reading.kind === "raw") return <RawCell text={reading.text} />;
  return (
    <NumberCell
      label={label}
      title={CLEAR_KEY_TITLE}
      value={reading.kind === "number" ? reading.value : null}
      decimals={decimals}
      onCommit={(value) => {
        const op =
          value === null ? removeHeaderField(keyName) : setScalar(keyName, value, decimals);
        if (op !== null) applyOp(op);
      }}
    />
  );
}

/** One bound of a range key's cell; the other bound is taken from the header as it is on commit. */
function BoundCell({
  label,
  keyName,
  range,
  which,
  decimals,
  applyOp,
}: {
  label: string;
  keyName: string;
  range: RangeReading;
  which: "min" | "max";
  decimals: boolean;
  applyOp: (op: Op) => void;
}) {
  return (
    <NumberCell
      label={`${label} ${which}`}
      title={CLEAR_RANGE_TITLE}
      value={range.kind === "bounds" ? range[which] : null}
      decimals={decimals}
      onCommit={(value) => {
        const op =
          value === null
            ? removeHeaderField(keyName)
            : setBound(keyName, currentHeader(), which, value, decimals);
        if (op !== null) applyOp(op);
      }}
    />
  );
}

/** The min and max cells of a row: its range key's two bounds, or its scalar max alone. */
export function BoundCells({ view, applyOp }: { view: SetupView; applyOp: (op: Op) => void }) {
  const { row, range } = view;
  const decimals = row.decimals ?? false;
  if (row.range === undefined || range === null) {
    return (
      <>
        <span />
        <ScalarCell
          label={`${row.label} max`}
          keyName={row.max}
          reading={view.max}
          decimals={decimals}
          applyOp={applyOp}
        />
      </>
    );
  }
  if (range.kind === "raw") return <RawCell text={range.text} wide />;
  const key = row.range;
  const cell = (which: "min" | "max") => (
    <BoundCell
      label={row.label}
      keyName={key}
      range={range}
      which={which}
      decimals={decimals}
      applyOp={applyOp}
    />
  );
  return (
    <>
      {cell("min")}
      {cell("max")}
    </>
  );
}
