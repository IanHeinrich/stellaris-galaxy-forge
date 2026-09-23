import { useRef, useState, type ReactNode } from "react";
import { IconPicker, type IconPickerItem } from "./IconPicker";
import { ENTER, ESCAPE } from "./keys";
import "./panels.css";

function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** What every editable field shares: its accessible name, and why it cannot take an edit now. */
interface FieldBase {
  label: string;
  /** Set when the field cannot take an edit: it shows disabled, and says why on hover. */
  disabledReason?: string;
}

type TextFieldProps = FieldBase & {
  className?: string;
  id?: string;
  title?: string;
  placeholder?: string;
  /** What the field shows until it is focused, when that differs from the text it edits. */
  display?: string;
  /** Called once the field is done with: after a commit, and when Escape abandons the edit. */
  onDone?: () => void;
} & (
    | {
        kind: "number";
        value: number;
        decimals?: number;
        step?: number;
        onCommit: (v: number) => void;
      }
    | { kind: "text"; value: string; onCommit: (v: string) => void }
  );

function fieldText(props: TextFieldProps): string {
  if (props.kind === "text") return props.value;
  return props.decimals === undefined ? String(props.value) : props.value.toFixed(props.decimals);
}

/**
 * A text or number the user types: commits on Enter or blur when the text differs from the shown
 * one; Escape abandons the edit.
 */
export function TextField(props: TextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = fieldText(props);
  const disabled = props.disabledReason !== undefined;
  const commit = () => {
    props.onDone?.();
    const text = draft;
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text === null || text === shown) return;
    if (props.kind === "text") {
      props.onCommit(text);
      return;
    }
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) props.onCommit(n);
  };
  return (
    <span
      className={classes("edit-field", "edit-text", disabled && "disabled", props.className)}
      title={props.disabledReason ?? props.title}
    >
      <input
        type={props.kind}
        id={props.id}
        step={props.kind === "number" ? (props.step ?? 1) : undefined}
        aria-label={props.label}
        placeholder={props.placeholder}
        disabled={disabled}
        value={draft ?? props.display ?? shown}
        onFocus={() => {
          if (props.display !== undefined) setDraft(shown);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === ENTER) e.currentTarget.blur();
          else if (e.key === ESCAPE) {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      <span className="edit-field-icon" aria-hidden="true">
        ✎
      </span>
    </span>
  );
}

/** A choice from a list, each item with its icon: the picker's button in the field style. */
export function PickerField({
  label,
  current,
  items,
  title,
  disabledReason,
  empty,
  onOpen,
  onPick,
}: FieldBase & {
  current: IconPickerItem;
  items: readonly IconPickerItem[];
  title?: string;
  empty?: ReactNode;
  onOpen?: () => void;
  onPick: (key: string) => void;
}) {
  return (
    <IconPicker
      label={label}
      title={disabledReason ?? title}
      disabled={disabledReason !== undefined}
      current={current}
      items={items}
      empty={empty}
      triggerClassName="edit-field"
      onOpen={onOpen}
      onPick={onPick}
    />
  );
}

/** One colour a swatch field offers; one with no `color` is named without a swatch. */
export interface Swatch {
  key: string;
  label: string;
  color?: string;
}

function swatchItem(swatch: Swatch): IconPickerItem {
  return {
    key: swatch.key,
    label: swatch.label,
    icon:
      swatch.color === undefined ? undefined : (
        <span className="swatch" style={{ background: swatch.color }} />
      ),
  };
}

/** A colour picked from a palette, shown as its swatch and its name. */
export function SwatchField({
  current,
  swatches,
  ...rest
}: FieldBase & {
  current: Swatch;
  swatches: readonly Swatch[];
  title?: string;
  onPick: (key: string) => void;
}) {
  return <PickerField current={swatchItem(current)} items={swatches.map(swatchItem)} {...rest} />;
}

/** A yes or no, as a labelled checkbox in the field style. */
export function ToggleField({
  label,
  checked,
  title,
  disabledReason,
  onChange,
}: FieldBase & { checked: boolean; title?: string; onChange: (checked: boolean) => void }) {
  const disabled = disabledReason !== undefined;
  return (
    <label
      className={classes("edit-field", "edit-toggle", disabled && "disabled")}
      title={disabledReason ?? title}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

/** The editable fields a page opens with, under a small title, each row a label and its field. */
export function EditBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="edit-block" role="group" aria-label={title}>
      <div className="edit-block-title">{title}</div>
      <div className="edit-grid">{children}</div>
    </div>
  );
}

/** One row of an edit block: what the field is, then the field. */
export function EditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="edit-label">{label}</span>
      <span className="edit-cell">{children}</span>
    </>
  );
}

/** A line under the fields of an edit block, across the whole row. */
export function EditNote({ children }: { children: ReactNode }) {
  return <div className="edit-note">{children}</div>;
}

/** The foot of a page with editable fields: how to tell them from the information around them. */
export function EditKey() {
  return (
    <div className="edit-key">
      <span className="edit-field edit-key-sample" aria-hidden="true">
        Aa
      </span>
      editable · plain text is information
    </div>
  );
}
