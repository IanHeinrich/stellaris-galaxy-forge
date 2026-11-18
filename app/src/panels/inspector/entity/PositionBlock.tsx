import type { ReactNode } from "react";
import type { PositionField } from "../../../lib/details/orbitIntent";
import { polarAbout } from "../../../lib/details/orbits";
import { EditBlock } from "../../EditField";
import { RadiusAngleFields } from "../RadiusAngleFields";

type Point = { x: number; y: number };

/**
 * Where a thing placed about a point stands, as a Position block of Distance and Angle fields. A
 * commit names the field and the value typed; the caller turns it into its move.
 */
export function PositionBlock({
  centre,
  at,
  about,
  disabledReason,
  onCommit,
  children,
}: {
  /** The point the distance and angle are measured from. */
  centre: Point;
  /** Where it stands now. */
  at: Point;
  /** What the fields' titles say it stands about, such as "the star". */
  about: string;
  /** Set when it can't be moved: the fields show disabled, and say why on hover. */
  disabledReason?: string;
  onCommit: (field: PositionField, typed: number) => void;
  /** What shows under the fields, such as the refusal of the last move. */
  children?: ReactNode;
}) {
  const { radius, angle } = polarAbout(at, centre);
  return (
    <EditBlock title="Position">
      <RadiusAngleFields
        radius={radius}
        angle={angle}
        radiusLabel="Distance"
        radiusTitle={`How far it stands from ${about}`}
        angleTitle={`Where it stands about ${about}, in degrees`}
        disabledReason={disabledReason}
        onCommit={(field, { min }) => onCommit(field, min)}
      />
      {children}
    </EditBlock>
  );
}
