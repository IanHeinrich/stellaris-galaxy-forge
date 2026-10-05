import { OUTCOME_LABELS, type Outcome } from "../../lib/prepareCopy";
import { outcomeCss, OUTCOME_STROKE } from "../../lib/visual/outcomeColors";
import { systemOutcomes, usePrepareStore } from "../../store/prepareStore";
import "./chrome.css";

const OUTCOMES: readonly Outcome[] = ["seat", "zone"];

/**
 * What the map's rings mean, at its bottom left, with how many systems have each, while the map
 * shows at least one new starting position or fallen empire zone.
 */
export function PrepareLegend() {
  const shown = usePrepareStore((s) => s.outcomeShown);
  const preview = usePrepareStore((s) => s.preview);
  if (!shown || preview === null) return null;
  const counts = new Map<Outcome, number>();
  for (const outcome of systemOutcomes({ preview }).values()) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return (
    <div className="prepare-legend" role="note" aria-label="What the rings mean">
      {OUTCOMES.filter((outcome) => counts.has(outcome)).map((outcome) => (
        <div key={outcome} className="prepare-legend-row">
          <span
            className="prepare-legend-ring"
            style={{ borderColor: outcomeCss(outcome), borderWidth: OUTCOME_STROKE.width }}
            aria-hidden="true"
          />
          <span>{OUTCOME_LABELS[outcome]}</span>
          <span className="muted">{counts.get(outcome)}</span>
        </div>
      ))}
    </div>
  );
}
