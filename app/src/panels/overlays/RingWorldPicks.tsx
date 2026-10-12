import {
  CLEAR_PLANETS,
  LEAVE_PLANETS,
  PLANETS_LABEL,
  QUADRANTS,
  QUADRANTS_LABEL,
  RING_STAGES,
  SET_ALL,
} from "../../lib/ringWorldAdd";
import { useMegastructureAddStore } from "../../store/megastructureAdd";

/**
 * The picks of a whole ring world: the stage of each quadrant, A to D, with a line that sets them
 * all, and whether the system's planets stay or are cleared. Clear is off with `clearBlocked`'s
 * reason when the system can't be cleared or its clearing isn't read yet.
 */
export function RingWorldPicks({ clearBlocked }: { clearBlocked: string | null }) {
  const stages = useMegastructureAddStore((s) => s.ringStages);
  const clear = useMegastructureAddStore((s) => s.ringClear);
  const setRingStage = useMegastructureAddStore((s) => s.setRingStage);
  const setRingStages = useMegastructureAddStore((s) => s.setRingStages);
  const setRingClear = useMegastructureAddStore((s) => s.setRingClear);
  const clearing = clear && clearBlocked === null;

  return (
    <div className="ring-world-picks">
      <table className="ring-world-quadrants" aria-label={QUADRANTS_LABEL}>
        <thead>
          <tr>
            <th scope="col">{QUADRANTS_LABEL}</th>
            {RING_STAGES.map(({ stage, label }) => (
              <th key={stage} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUADRANTS.map((quadrant, i) => (
            <tr key={quadrant}>
              <th scope="row">{quadrant}</th>
              {RING_STAGES.map(({ stage, label }) => (
                <td key={stage}>
                  <input
                    type="radio"
                    name={`ring-quadrant-${quadrant}`}
                    aria-label={`${quadrant} ${label}`}
                    checked={stages[i] === stage}
                    onChange={() => setRingStage(i, stage)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ring-world-set-all">
        <span className="muted">{SET_ALL}</span>
        {RING_STAGES.map(({ stage, label }) => (
          <button key={stage} type="button" onClick={() => setRingStages(stage)}>
            {label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={PLANETS_LABEL} className="ring-world-planets">
        <span className="muted">{PLANETS_LABEL}</span>
        <label>
          <input
            type="radio"
            name="ring-planets"
            checked={!clearing}
            onChange={() => setRingClear(false)}
          />
          <span>{LEAVE_PLANETS}</span>
        </label>
        <label>
          <input
            type="radio"
            name="ring-planets"
            checked={clearing}
            disabled={clearBlocked !== null}
            onChange={() => setRingClear(true)}
          />
          <span>{CLEAR_PLANETS}</span>
        </label>
        {clearBlocked !== null && <span className="muted">{clearBlocked}</span>}
      </div>
    </div>
  );
}
