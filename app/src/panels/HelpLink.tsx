import type { GuidePlace } from "../lib/guideLinks";
import { openGuide } from "./helpLinks";
import "./panels.css";

/**
 * A small "?" that opens the guide on `topic`, at `place` or the heading `anchor` names there;
 * `dismiss` closes the menu it sits in.
 */
export function HelpLink({
  place,
  anchor,
  topic,
  dismiss,
}: {
  place: GuidePlace;
  anchor?: string;
  topic: string;
  dismiss?: () => void;
}) {
  const label = `Help: ${topic}`;
  return (
    <button
      type="button"
      className="link help-link"
      aria-label={label}
      title={label}
      onClick={() => {
        dismiss?.();
        openGuide(place, anchor);
      }}
    >
      ?
    </button>
  );
}
