import { OUTCOME_LABELS, type Outcome } from "../../lib/prepareCopy";
import { outcomeCss, OUTCOME_STROKES } from "../../lib/visual/outcomeColors";
import { systemOutcomes, usePrepareStore } from "../../store/prepareStore";
import "./chrome.css";

/** Every outcome the legend names, in its order; a new zone only on a Paint a Galaxy map. */
const OUTCOMES: readonly Outcome[] = ["ordinary", "rolled", "seat", "zone"];

/**
 * What the map's outcome rings mean, at its bottom left, with how many systems have each, while
 * the map shows them.
 */
export function PrepareLegend() {
  const shown = usePrepareStore((s) => s.outcomeShown);
  const preview = usePrepareStore((s) => s.preview);
  const choices = usePrepareStore((s) => s.choices);
  if (!shown || preview === null) return null;
  const counts = new Map<Outcome, number>();
  for (const outcome of systemOutcomes({ preview, choices }).values()) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  const outcomes = OUTCOMES.filter(
    (outcome) => outcome !== "zone" || preview.profile === "paint_a_galaxy",
  );
  return (
    <div className="prepare-legend" role="note" aria-label="What the rings mean">
      {outcomes.map((outcome) => (
        <div key={outcome} className="prepare-legend-row">
          <span
            className="prepare-legend-ring"
            style={{
              borderColor: outcomeCss(outcome),
              borderWidth: OUTCOME_STROKES[outcome].width,
              opacity: OUTCOME_STROKES[outcome].alpha,
            }}
            aria-hidden="true"
          />
          <span>{OUTCOME_LABELS[outcome]}</span>
          <span className="muted">{counts.get(outcome) ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
