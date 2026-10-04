import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ENTER, ESCAPE } from "./keys";

/**
 * The text typed into an input before it is committed. `inputProps` go on the input: Enter or
 * blur hands the draft to `onCommit` when it differs from `shown`, and Escape abandons it. The
 * input shows `draft` while there is one. `onDone` runs when the input is done with either way.
 */
export function useDraft({
  shown,
  onCommit,
  onDone,
}: {
  shown: string;
  onCommit: (text: string) => void;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const settle = () => {
    onDone?.();
    const text = draft;
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text !== null && text !== shown) onCommit(text);
  };
  return {
    draft,
    startDraft: () => setDraft(shown),
    inputProps: {
      onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      onBlur: settle,
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === ENTER) e.currentTarget.blur();
        else if (e.key === ESCAPE) {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      },
    },
  };
}
