import { useState } from "react";
import { parseDays } from "../../../lib/details/modifierPicker";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";

const DEFAULT_DAYS = 360;

/** How long the next add lasts: for ever, or a number of days. */
export function ModifierDuration() {
  const days = useModifierPickerStore((s) => s.days);
  const [text, setText] = useState(String(days ?? DEFAULT_DAYS));
  const setDays = useModifierPickerStore.getState().setDays;
  return (
    <div className="mp-duration" role="group" aria-label="How long it lasts">
      <label>
        <input
          type="radio"
          name="mp-duration"
          checked={days === null}
          onChange={() => setDays(null)}
        />
        Permanent
      </label>
      <label>
        <input
          type="radio"
          name="mp-duration"
          checked={days !== null}
          onChange={() => setDays(parseDays(text) ?? DEFAULT_DAYS)}
        />
        For
      </label>
      <input
        type="number"
        min={1}
        aria-label="Days"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseDays(e.target.value);
          if (parsed !== null) setDays(parsed);
        }}
        onFocus={() => {
          if (days === null) setDays(parseDays(text) ?? DEFAULT_DAYS);
        }}
      />
      days
    </div>
  );
}
