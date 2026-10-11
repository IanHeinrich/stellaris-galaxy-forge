import type { Bounds } from "../../generated/Bounds";
import { screenDirection, wholeTurn } from "../../lib/details/orbits";

/** The dial's radius, in its own units; it is 28px across. */
const R = 12;

/** A point on the rim at a save angle, turned as the system view turns it. */
function rim(angle: number, radius = R): { x: number; y: number } {
  const d = screenDirection(angle);
  return { x: d.x * radius, y: d.y * radius };
}

const f = (n: number) => n.toFixed(2);

/**
 * The wedge from the centre between two save angles, `min` below `max`, swept the way the system
 * view turns from one to the other.
 */
function wedgePath(min: number, max: number): string {
  const a = rim(min);
  const b = rim(max);
  const step = rim(min + 1);
  const sweep = a.x * step.y - a.y * step.x > 0 ? 1 : 0;
  const large = max - min > 180 ? 1 : 0;
  return `M0 0 L${f(a.x)} ${f(a.y)} A${R} ${R} 0 ${large} ${sweep} ${f(b.x)} ${f(b.y)} Z`;
}

/**
 * How far round a body turns from the one before it, drawn as the system view would: the body
 * before it on the rim at 0, then the step as a wedge for a range, a line for one angle, or the
 * whole disc for any. Nothing for a step that isn't known. The row's text says the same, so the
 * dial is hidden from screen readers.
 */
export function AngleDial({ step }: { step: Bounds | null }) {
  if (step === null) return null;
  const reference = rim(0);
  return (
    <svg className="ins-dial" viewBox="-14 -14 28 28" aria-hidden="true">
      {wholeTurn(step) ? (
        <circle className="ins-dial-any" r={R} />
      ) : step.min === step.max ? (
        <>
          <line
            className="ins-dial-line"
            x1="0"
            y1="0"
            x2={f(rim(step.min).x)}
            y2={f(rim(step.min).y)}
          />
          <circle className="ins-dial-at" cx={f(rim(step.min).x)} cy={f(rim(step.min).y)} r="2" />
        </>
      ) : (
        <path className="ins-dial-wedge" d={wedgePath(step.min, step.max)} />
      )}
      <circle className="ins-dial-rim" r={R} />
      <circle className="ins-dial-centre" r="1.2" />
      <circle className="ins-dial-ref" cx={f(reference.x)} cy={f(reference.y)} r="2" />
    </svg>
  );
}
