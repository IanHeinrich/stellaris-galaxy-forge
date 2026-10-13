import { choiceOf, type Choice } from "../lib/toolCopy";

/** A drop-down over `choices`; it reports a choice, never the text the element hands back. */
export function Select<T extends string>({
  value,
  choices,
  onChange,
  className,
  label,
}: {
  value: T;
  choices: readonly Choice<T>[];
  onChange(value: T): void;
  className?: string;
  label?: string;
}) {
  return (
    <select
      className={className}
      aria-label={label}
      value={value}
      onChange={(e) => {
        const chosen = choiceOf(choices, e.target.value);
        if (chosen !== null) onChange(chosen);
      }}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}
