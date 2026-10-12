import type { RingWorldSize } from "../../lib/megastructurePicks";
import {
  CLEAR_PLANETS,
  LEAVE_PLANETS,
  OTHER_SIZE,
  PLANETS_LABEL,
  QUADRANTS,
  QUADRANTS_LABEL,
  RING_STAGES,
  SET_ALL,
  SIZE_LABEL,
} from "../../lib/ringWorldAdd";
import { useMegastructureAddStore } from "../../store/megastructureAdd";

/**
 * The picks of a ring world: its size, among `sizes` when there is more than one, and under it an
 * area that keeps one height whatever it shows. Where `size`'s ring is refused, the area says why,
 * and points to another size that fits. Otherwise, with `ring`, the Ring tile, it holds the stage
 * of each quadrant, A to D, at the stages `size` offers, with a line that sets them all, and
 * whether the system's planets stay or are cleared. Clear is off with `clearBlocked`'s reason
 * when the system can't be cleared or its clearing isn't read yet.
 */
export function RingWorldPicks({
  sizes,
  size,
  ring,
  clearBlocked,
}: {
  sizes: readonly RingWorldSize[];
  size: RingWorldSize;
  ring: boolean;
  clearBlocked: string | null;
}) {
  const stages = useMegastructureAddStore((s) => s.ringStages);
  const clear = useMegastructureAddStore((s) => s.ringClear);
  const setRingStage = useMegastructureAddStore((s) => s.setRingStage);
  const setRingStages = useMegastructureAddStore((s) => s.setRingStages);
  const setRingSize = useMegastructureAddStore((s) => s.setRingSize);
  const setRingClear = useMegastructureAddStore((s) => s.setRingClear);
  const clearing = clear && clearBlocked === null;
  const columns = RING_STAGES.filter(({ stage }) => size.stages.includes(stage));
  const otherFits = sizes.some((option) => option.ring !== size.ring && option.refused === null);

  return (
    <div className="ring-world-picks">
      {sizes.length > 1 && (
        <div role="radiogroup" aria-label={SIZE_LABEL} className="ring-world-size">
          <span className="muted">{SIZE_LABEL}</span>
          {sizes.map((option) => (
            <label key={option.ring}>
              <input
                type="radio"
                name="ring-size"
                checked={option.ring === size.ring}
                onChange={() => setRingSize(option.ring, option.stages)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
      {size.refused !== null ? (
        <div className="ring-world-picks-area ring-world-picks-refused">
          <p className="megastructure-add-refusal">{size.refused}</p>
          {otherFits && <p className="muted">{OTHER_SIZE}</p>}
        </div>
      ) : (
        <div className="ring-world-picks-area">
          {ring && (
            <>
              <table className="ring-world-quadrants" aria-label={QUADRANTS_LABEL}>
                <thead>
                  <tr>
                    <th scope="col">{QUADRANTS_LABEL}</th>
                    {columns.map(({ stage, label }) => (
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
                      {columns.map(({ stage, label }) => (
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
                {columns.map(({ stage, label }) => (
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
