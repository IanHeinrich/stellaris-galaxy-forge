import type { ReactNode } from "react";

/** One choice of a `RadioChoice`: its words, whether it is the one chosen, and what picking it does. */
export interface RadioOption {
  key: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onPick: () => void;
}

/** A labelled row of radio buttons, `name` grouping them; `after` goes at the end of the row. */
export function RadioChoice({
  label,
  name,
  options,
  after,
}: {
  label: string;
  name: string;
  options: readonly RadioOption[];
  after?: ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="radio-choice">
      <span className="muted">{label}</span>
      {options.map((option) => (
        <label key={option.key}>
          <input
            type="radio"
            name={name}
            checked={option.checked}
            disabled={option.disabled}
            onChange={option.onPick}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {after}
    </div>
  );
}
