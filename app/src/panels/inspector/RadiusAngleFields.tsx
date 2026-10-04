import type { Bounds } from "../../generated/Bounds";
import { rounded } from "../../lib/details/orbits";
import { BoundsField } from "../BoundsField";
import { EditRow } from "../EditField";

/**
 * The Radius row and the Angle row of a thing placed about a point: the radius in two decimals,
 * the angle in degrees, shown whole until focused. A commit names the field and the value typed.
 */
export function RadiusAngleFields({
  radius,
  angle,
  radiusLabel,
  radiusTitle,
  angleTitle,
  ranges = false,
  onCommit,
}: {
  radius: number;
  angle: number;
  radiusLabel: string;
  radiusTitle: string;
  angleTitle: string;
  /** Whether the source takes a range; a source that never does leaves it out. */
  ranges?: boolean;
  onCommit: (field: "radius" | "angle", next: Bounds) => void;
}) {
  return (
    <>
      <EditRow label={radiusLabel}>
        <BoundsField
          label={radiusLabel}
          title={radiusTitle}
          value={{ min: radius, max: radius }}
          editAs={rounded}
          ranges={ranges}
          onCommit={(next) => onCommit("radius", next)}
        />
      </EditRow>
      <EditRow label="Angle">
        <BoundsField
          label="Angle"
          title={angleTitle}
          value={{ min: angle, max: angle }}
          editAs={rounded}
          ranges={ranges}
          display={(n) => String(Math.round(n) % 360)}
          onCommit={(next) => onCommit("angle", next)}
        />
      </EditRow>
    </>
  );
}
